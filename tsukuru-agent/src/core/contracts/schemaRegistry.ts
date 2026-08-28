export type ContractKind = 'request' | 'result' | 'manifest' | 'container-provenance' | 'engine-options';

export interface ContractValidationError {
    path: string;
    keyword: string;
    message: string;
}

export interface ContractValidationResult {
    ok: boolean;
    errors: ContractValidationError[];
}

type JsonSchema = boolean | { [key: string]: any };

const requestV1 = require('./schemas/v1/request.schema.json') as JsonSchema;
const resultV1 = require('./schemas/v1/result.schema.json') as JsonSchema;
const manifestV1 = require('./schemas/v1/manifest.schema.json') as JsonSchema;
const provenanceV1 = require('./schemas/v1/container-provenance.schema.json') as JsonSchema;
const requestV2 = require('./schemas/v2/request.schema.json') as JsonSchema;
const resultV2 = require('./schemas/v2/result.schema.json') as JsonSchema;
const manifestV2 = require('./schemas/v2/manifest.schema.json') as JsonSchema;
const engineOptionsV2 = require('./schemas/v2/engine-options.schema.json') as JsonSchema;

export const contractSchemaRegistry: Readonly<Record<string, JsonSchema>> = Object.freeze({
    'request:1': requestV1,
    'request:2': requestV2,
    'result:1': resultV1,
    'result:2': resultV2,
    'manifest:1': manifestV1,
    'manifest:2': manifestV2,
    'container-provenance:1': provenanceV1,
    'engine-options:2': engineOptionsV2,
});

function typeMatches(type: string, value: unknown): boolean {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    return typeof value === type;
}

function pointerValue(document: JsonSchema, fragment: string): JsonSchema {
    if (!fragment || fragment === '#') return document;
    if (!fragment.startsWith('#/')) throw new Error(`unsupported schema reference fragment: ${fragment}`);
    let current: any = document;
    for (const raw of fragment.slice(2).split('/')) {
        const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        current = current?.[key];
    }
    if (current === undefined) throw new Error(`schema reference does not exist: ${fragment}`);
    return current as JsonSchema;
}

function resolveReference(reference: string, currentDocument: JsonSchema): { schema: JsonSchema; document: JsonSchema } {
    const separator = reference.indexOf('#');
    const documentId = separator >= 0 ? reference.slice(0, separator) : reference;
    const fragment = separator >= 0 ? reference.slice(separator) : '';
    const document = documentId
        ? Object.values(contractSchemaRegistry).find((candidate) => candidate !== false
            && candidate !== true && candidate.$id === documentId)
        : currentDocument;
    if (document === undefined) throw new Error(`schema reference document is not registered: ${documentId}`);
    return { schema: pointerValue(document, fragment), document };
}

function appendError(
    errors: ContractValidationError[],
    path: string,
    keyword: string,
    message: string,
): void {
    errors.push({ path: path || '/', keyword, message });
}

function branchMatches(schema: JsonSchema, value: unknown, document: JsonSchema): boolean {
    const errors: ContractValidationError[] = [];
    validateNode(schema, value, '', errors, document);
    return errors.length === 0;
}

function validateCombinators(
    schema: { [key: string]: any },
    value: unknown,
    path: string,
    errors: ContractValidationError[],
    document: JsonSchema,
): void {
    if (Array.isArray(schema.allOf)) {
        for (const branch of schema.allOf) validateNode(branch, value, path, errors, document);
    }
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch: JsonSchema) => branchMatches(branch, value, document))) {
        appendError(errors, path, 'anyOf', 'must match at least one allowed contract branch');
    }
    if (Array.isArray(schema.oneOf)) {
        const matches = schema.oneOf.filter((branch: JsonSchema) => branchMatches(branch, value, document)).length;
        if (matches !== 1) appendError(errors, path, 'oneOf', 'must match exactly one allowed contract branch');
    }
    if (schema.not !== undefined && branchMatches(schema.not, value, document)) {
        appendError(errors, path, 'not', 'matches a forbidden contract branch');
    }
    if (schema.if !== undefined) {
        const selected = branchMatches(schema.if, value, document) ? schema.then : schema.else;
        if (selected !== undefined) validateNode(selected, value, path, errors, document);
    }
}

function validateObject(
    schema: { [key: string]: any },
    value: Record<string, unknown>,
    path: string,
    errors: ContractValidationError[],
    document: JsonSchema,
): void {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const property of required) {
        if (!Object.prototype.hasOwnProperty.call(value, property)) {
            appendError(errors, `${path}/${property}`, 'required', 'is required');
        }
    }
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [property, propertyValue] of Object.entries(value)) {
        const propertyPath = `${path}/${property}`;
        if (Object.prototype.hasOwnProperty.call(properties, property)) {
            validateNode(properties[property], propertyValue, propertyPath, errors, document);
        } else if (schema.additionalProperties === false) {
            appendError(errors, propertyPath, 'additionalProperties', 'is not an allowed property');
        } else if (typeof schema.additionalProperties === 'object') {
            validateNode(schema.additionalProperties, propertyValue, propertyPath, errors, document);
        }
    }
    if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
        appendError(errors, path, 'minProperties', `must contain at least ${schema.minProperties} properties`);
    }
}

function validateNode(
    schema: JsonSchema,
    value: unknown,
    path: string,
    errors: ContractValidationError[],
    document: JsonSchema,
): void {
    if (schema === true) return;
    if (schema === false) {
        appendError(errors, path, 'falseSchema', 'is not allowed');
        return;
    }
    if (typeof schema.$ref === 'string') {
        const resolved = resolveReference(schema.$ref, document);
        validateNode(resolved.schema, value, path, errors, resolved.document);
        return;
    }

    validateCombinators(schema, value, path, errors, document);

    if (schema.const !== undefined && !Object.is(value, schema.const)) {
        appendError(errors, path, 'const', `must equal ${JSON.stringify(schema.const)}`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((candidate: unknown) => Object.is(candidate, value))) {
        appendError(errors, path, 'enum', 'is not one of the allowed values');
    }

    if (schema.type !== undefined) {
        const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!allowedTypes.some((type: string) => typeMatches(type, value))) {
            appendError(errors, path, 'type', `must be ${allowedTypes.join(' or ')}`);
            return;
        }
    }

    if (typeof value === 'string') {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            appendError(errors, path, 'minLength', `must contain at least ${schema.minLength} characters`);
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
            appendError(errors, path, 'maxLength', `must contain no more than ${schema.maxLength} characters`);
        }
        if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
            appendError(errors, path, 'pattern', `must match ${schema.pattern}`);
        }
    }

    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
            appendError(errors, path, 'minimum', `must be at least ${schema.minimum}`);
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
            appendError(errors, path, 'maximum', `must be no more than ${schema.maximum}`);
        }
    }

    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
            appendError(errors, path, 'minItems', `must contain at least ${schema.minItems} items`);
        }
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
            appendError(errors, path, 'maxItems', `must contain no more than ${schema.maxItems} items`);
        }
        if (schema.items !== undefined) {
            value.forEach((item, index) => validateNode(schema.items, item, `${path}/${index}`, errors, document));
        }
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        validateObject(schema, value as Record<string, unknown>, path, errors, document);
    }
}

export function validateContract(kind: ContractKind, version: number, value: unknown): ContractValidationResult {
    const schema = contractSchemaRegistry[`${kind}:${version}`];
    if (schema === undefined) {
        return {
            ok: false,
            errors: [{ path: '/schemaVersion', keyword: 'supportedVersion', message: `unsupported ${kind} schema version: ${version}` }],
        };
    }
    const errors: ContractValidationError[] = [];
    validateNode(schema, value, '', errors, schema);
    return { ok: errors.length === 0, errors };
}
