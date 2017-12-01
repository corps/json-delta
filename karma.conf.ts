export = function(config: any) {
  config.set({
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: "",
    browserNoActivityTimeout: 30000,
    frameworks: ["qunit"],
    plugins: ["karma-qunit", "karma-webpack"],

    client: {
      clearContext: false,
      qunit: {
        showUI: true,
        testTimeout: 5000,
      },
    },

    files: [
      "node_modules/quick_check/dist/quick-check.js",
      "tests.js"
    ],

    exclude: [],

    preprocessors: {
      "tests.js": ["webpack"],
    },

    webpackMiddleware: { stats: "errors-only" },
    webpack: {
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: "ts-loader",
            options: {
              transpileOnly: true
            }
          },
        ]
      }
    },
  });
};
