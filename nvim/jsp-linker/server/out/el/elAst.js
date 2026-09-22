"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.literalNodeType = literalNodeType;
/**
 * The fixed Java type a `Literal` node's own syntax determines -- `undefined` for `null`, which has
 * no type to report. Shared by `elTypeInference.ts`'s bare-literal case (`${'x'}`) and
 * `elChainAdapter.ts`'s literal-rooted chain base (`${'x'.concat(y)}`), so there's exactly one
 * `literalKind -> FQCN` mapping rather than one per caller.
 */
function literalNodeType(node) {
    switch (node.literalKind) {
        case 'boolean':
            return 'java.lang.Boolean';
        case 'integer':
            return 'java.lang.Long';
        case 'float':
            return 'java.lang.Double';
        case 'string':
            return 'java.lang.String';
        case 'null':
            return undefined;
    }
}
//# sourceMappingURL=elAst.js.map