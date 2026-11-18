const { defineConfig } = require('eslint/config');
const universe = require('eslint-config-universe/flat/native');

module.exports = defineConfig([
  { ignores: ['build', 'example/ios', 'example/android', 'example/.expo'] },
  ...universe,
  {
    // CommonJS config files run in Node.
    files: ['**/*.config.js', '**/*.config.cjs'],
    languageOptions: {
      globals: { __dirname: 'readonly', module: 'writable', require: 'readonly' },
    },
  },
]);
