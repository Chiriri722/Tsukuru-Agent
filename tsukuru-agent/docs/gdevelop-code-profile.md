# Experimental GDevelop generated-code string profile

Tsukuru Agent keeps every GDevelop `code*.js` file protected by default. The
experimental profile is enabled only when both extraction and application use
`options.experimentalGdevelopCodeStrings: true`. Verification can then validate
the resulting manifest without executing the JavaScript.

## Automatically extractable subset

The parser uses Acorn in static script mode. It accepts only a direct string
literal used as the first argument of one of these generated-object calls:

```js
gdjs.SceneCode.GDDialogueObjects1[i].setString("Visible dialogue");
gdjs.SceneCode.GDDescriptionObjects2[j].setBBText("Visible [b]text[/b]");
```

The collection property must match `GD…Objects<number>`, the object must be an
indexed member expression, and the method must be `setString` or `setBBText`.
Empty strings, identifier-like values, resource paths, URLs, and literals in
every other AST context remain excluded from automatic extraction. Template
literals, concatenations, variables, function results, event identifiers, and
runtime configuration are also excluded.

`_Extract/gdevelop-code-report.json` records scanned files, parse errors, the
safe-candidate count, and every ambiguous candidate with its exclusion reason.
Ambiguous candidates are never silently promoted to the manifest.

## Apply-time controls

Each accepted manifest entry binds the source-file SHA-256 snapshot, literal
hash, byte span, quote style, generated setter name, and AST candidate index.
Apply reparses the unchanged source and rejects any mapping that no longer
points at the originally approved context. It encodes the translated string as
a JavaScript literal, reparses the output, and permits the whole-project
integrity comparator to ignore only the specifically approved `code*.js`
files. All other generated code, `gdjs/`, extensions, resources, entrypoints,
and wrapper files remain protected.

The original project or archive is never edited. Loose projects, Electron ASAR,
and NW.js `package.nw` publish only a validated separate copy. A missing opt-in,
changed source snapshot, forged AST mapping, parser failure, protected-file
change, or output validation failure rolls back without publishing an output.

## Request options

<!-- contract-example:request:2 -->
```json
{
  "schemaVersion": 2,
  "operation": "extract",
  "format": "auto",
  "projectPath": "C:\\Games\\GDevelopGame",
  "profile": "standard",
  "options": { "experimentalGdevelopCodeStrings": true },
  "patches": []
}
```

Use the same option for `apply`. Do not pass it to `patch`; patching remains
manifest-ID and source-hash based. This profile is intentionally incomplete and
may miss visible text in custom extensions or hand-written event code. Static
validation and a launch probe do not replace a real gameplay test.
