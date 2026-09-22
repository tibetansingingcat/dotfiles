"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneratedJavaCodeLensProvider = void 0;
exports.openGeneratedJava = openGeneratedJava;
exports.openGeneratedClass = openGeneratedClass;
const vscode = __importStar(require("vscode"));
const generatedJavaResolver_1 = require("./generatedJavaResolver");
/**
 * Shows CodeLenses linking to a .tag/.jsp file's Jasper-generated Java
 * source and/or compiled class -- but only for whichever of those actually
 * exist on disk (see generatedJavaResolver.ts for why coverage is partial).
 * No CodeLens is shown at all for an artifact that doesn't exist, rather
 * than a broken/greyed-out link.
 */
class GeneratedJavaCodeLensProvider {
    async provideCodeLenses(document) {
        const artifacts = await (0, generatedJavaResolver_1.resolveGeneratedArtifacts)(document.uri);
        if (!artifacts) {
            return [];
        }
        const range = new vscode.Range(0, 0, 0, 0);
        const lenses = [];
        if (artifacts.java) {
            lenses.push(new vscode.CodeLens(range, {
                title: '→ Generated Java (Jasper)',
                command: 'vscode.open',
                arguments: [artifacts.java.uri],
            }));
        }
        if (artifacts.classFile) {
            // .class is raw bytecode, but the generic "vscode.open" command
            // (same path a normal double-click takes) handles that gracefully
            // (e.g. a binary-file prompt) -- it's showTextDocument specifically
            // that refuses binary content outright.
            lenses.push(new vscode.CodeLens(range, {
                title: '→ Generated Class (Jasper)',
                command: 'vscode.open',
                arguments: [artifacts.classFile.uri],
            }));
        }
        return lenses;
    }
}
exports.GeneratedJavaCodeLensProvider = GeneratedJavaCodeLensProvider;
/**
 * Command handlers for the "Open Generated Java (Jasper)" / "Open
 * Generated Class (Jasper)" context-menu items. Unlike the CodeLens (which
 * hides itself when there's nothing to link to), these are deliberate user
 * actions, so they stay visible for every .tag/.jsp file and report clearly
 * when the target doesn't exist yet, rather than silently doing nothing.
 */
async function openGeneratedJava(uri) {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
        return;
    }
    const artifacts = await (0, generatedJavaResolver_1.resolveGeneratedArtifacts)(targetUri);
    if (!artifacts?.java) {
        vscode.window.showInformationMessage("No generated Java source found for this yet -- it's only produced once a local Tomcat dev run actually serves it.");
        return;
    }
    await vscode.window.showTextDocument(artifacts.java.uri, { selection: artifacts.java.range });
}
async function openGeneratedClass(uri) {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
        return;
    }
    const artifacts = await (0, generatedJavaResolver_1.resolveGeneratedArtifacts)(targetUri);
    if (!artifacts?.classFile) {
        vscode.window.showInformationMessage('No generated .class file found for this yet -- build the project first (e.g. bin/build.sh) or run it locally.');
        return;
    }
    await vscode.commands.executeCommand('vscode.open', artifacts.classFile.uri);
}
//# sourceMappingURL=generatedJavaCodeLensProvider.js.map