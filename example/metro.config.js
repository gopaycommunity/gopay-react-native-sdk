// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Let Metro read the package in the parent folder. `experiments.autolinkingModuleResolution` in
// app.json resolves the package, and react-native, expo and the other packages it also installs in
// ../node_modules, to the copies that autolinking uses for this app.
config.watchFolders = [path.resolve(__dirname, '..')];

module.exports = config;
