//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // VS Code extensions run in a Node.js-context
  mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension
  output: {
    // the bundle is stored in the 'dist' folder (check package.json)
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'nosources-source-map',
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded
  },
  resolve: {
    // support reading TypeScript and JavaScript files
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  optimization: {
    minimize: true,
    usedExports: true, // Tree shaking
  },
  performance: {
    hints: false // Disable performance hints for now
  },
  infrastructureLogging: {
    level: 'log', // enables logging required for problem matchers
  },
};

/**@type {import('webpack').Configuration}*/
const productionConfig = {
  ...config,
  mode: 'production',
  devtool: 'hidden-source-map',
};

/**
 * @param {Object} env - Environment variables
 * @param {Object} argv - Command line arguments
 * @returns {import('webpack').Configuration}
 */
module.exports = (env, argv) => {
  if (argv.mode === 'production') {
    return productionConfig;
  }
  return config;
};
