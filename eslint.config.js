// SPDX-License-Identifier: GPL-2.0-or-later
// Lint rules close to GNOME Shell's own style. Development only.
import js from '@eslint/js';
import globals from 'globals';

export default [
    {ignores: ['dist/', 'node_modules/', 'tests/headless/work/']},
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...globals.es2021,
                global: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                console: 'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
            },
        },
        rules: {
            'arrow-parens': ['error', 'as-needed'],
            'brace-style': ['error', '1tbs', {allowSingleLine: true}],
            'comma-dangle': ['error', 'always-multiline'],
            'curly': ['error', 'multi-or-nest', 'consistent'],
            'eqeqeq': 'error',
            'indent': ['error', 4, {
                SwitchCase: 0,
                ignoredNodes: [
                    'CallExpression > ArrowFunctionExpression',
                    'CallExpression[callee.object.name=GObject][callee.property.name=registerClass] > ClassExpression:first-child',
                ],
            }],
            'max-len': ['error', {code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true}],
            'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}],
            'no-var': 'error',
            'object-curly-spacing': ['error', 'never'],
            'prefer-const': 'error',
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
        },
    },
    {
        files: ['eslint.config.js'],
        languageOptions: {globals: globals.node},
    },
    {
        // Evaluated inside the test shell through org.gnome.Shell.Eval.
        files: ['tests/headless/prelude.js'],
        languageOptions: {sourceType: 'script', globals: {Main: 'readonly', imports: 'readonly'}},
    },
];
