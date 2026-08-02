"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANIFEST_SCHEMA_VERSION = exports.MANIFEST_FILE = void 0;
exports.createManifest = createManifest;
exports.sha256Text = sha256Text;
exports.sha256Bytes = sha256Bytes;
/**
 * Extract/manifest.json 스키마 및 해시 유틸리티 (계획서 §Manifest와 안전성).
 * Electron 비의존.
 */
const crypto_1 = __importDefault(require("crypto"));
exports.MANIFEST_FILE = 'manifest.json';
exports.MANIFEST_SCHEMA_VERSION = 1;
function createManifest(format) {
    return {
        schemaVersion: exports.MANIFEST_SCHEMA_VERSION,
        format,
        createdAt: new Date().toISOString(),
        entries: [],
    };
}
/** 원문 문자열(UTF-8)의 SHA-256 hex. */
function sha256Text(text) {
    return crypto_1.default.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
/** 바이너리의 SHA-256 hex. */
function sha256Bytes(data) {
    return crypto_1.default.createHash('sha256').update(data).digest('hex');
}
