"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageFromJdtPath = packageFromJdtPath;
/**
 * The package of a `jdt://` URI's own target class, read directly off the URI's path -- redhat.java's
 * own `jdt://contents/<jar-or-module>/<package with dots>/<ClassName>.java?<query>` shape always puts
 * the full dotted package as the one path segment immediately before the filename, for *any*
 * decompiled, binary-origin class, jar dependency or JDK module alike (confirmed against two real,
 * live examples: a Cactuslab library jar's own
 * `.../cactuslab-pages-5.1.14.jar/com.cactuslab.pages/Paginator.java`, and a JDK module's own
 * `.../java.base/java.util/List.java`).
 *
 * This exists because `qualifyReturnType`'s (`javaSymbols.ts`) other strategy -- matching a
 * go-to-definition `Location` against a classpath-wide `executeWorkspaceSymbolProvider` search for
 * the same bare name, purely to read that matched symbol's own `containerName` -- turned out to
 * structurally never match a `jdt://` target at all: live debugging `java.util.List` specifically
 * found go-to-definition resolving correctly (to this exact `jdt://` URI), but none of the (844, for
 * the common name "List" alone) workspace-symbol candidates on the classpath matching it by location,
 * silently leaving `List<AMemberTag>` unqualified and reaching `resolveClass` bare --
 * indistinguishable there from any of the many *other*, unrelated classpath classes also simply named
 * "List" (see `resolveClass`'s own doc on why it refuses to guess among those). Reading the package
 * straight off the URI sidesteps that classpath-wide search (and its apparent blind spot for `jdt://`
 * targets) entirely, for the one case where the URI itself already carries the answer.
 *
 * `undefined` -- not this shortcut, fall through to `qualifyReturnType`'s own `file://` path (a
 * classpath-wide workspace-symbol search) instead -- for any other scheme: this project's own source
 * is always `file://`, whose path is a real filesystem tree, not one dotted-package path segment.
 *
 * Kept in its own, `vscode`-free module (matching `javaHeritageClause.ts`'s own precedent) purely so
 * this parsing can be unit-tested with plain `node --test`, unlike the rest of `javaSymbols.ts`.
 */
function packageFromJdtPath(scheme, path) {
    if (scheme !== 'jdt') {
        return undefined;
    }
    const segments = path.split('/').filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : undefined;
}
//# sourceMappingURL=jdtUri.js.map