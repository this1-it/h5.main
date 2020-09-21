'use strict';

const DEFAULT_OPTIONS = {
  moduleStartTimeout: 2000,
  rootPath: process.cwd(),
  env: process.env.NODE_ENV || 'development',
  startTime: Date.now(),
  id: 'no-name-app'
};

const { MessageBroker } = require('h5.pubsub');
const appUtils = require('./utils/app');
const logUtils = require('./utils/log');

module.exports = (app, modules) => {
  if (app === null || typeof app !== 'object') {
    app = {};
  }

  if (app.options === null || typeof app.options !== 'object') {
    app.options = {};
  }

  app.options = { ...DEFAULT_OPTIONS, ...app.options };
  app.broker = new MessageBroker();
  app.main = {
    modules: {},
    appModules: {},
    setUpModules: [],
    startedModules: []
  };

  appUtils.extend(app);
  logUtils.extend(app, { appId: app.options.id });

  /**
   * @private
   * @param {Object} module
   * @param {Object} appModule
   */
  function startModuleSync(module, appModule) {
    setUpRequiredDependencies(module, appModule);
    setUpOptionalDependencies(module, appModule);
    if (appModule.start) {
      appModule.start(app, module);
    }
    app.broker.publish('app.modules.started', { module, appModule });
  }

  /**
     * @private
     * @param {Object} module
     * @param {Object} appModule
     */
  function startModuleAsync(module, appModule) {
    let promise = new Promise(function (resolve, reject) {
      setUpRequiredDependencies(module, appModule);
      setUpOptionalDependencies(module, appModule);
      appModule.start(app, module, (err) => {
        if (err) {
          throw err;
        }
        app.broker.publish('app.modules.started', { module, appModule });
        resolve();
      });
    })


    return new Promise(function (resolve, reject) {
      let cleared = false;
      // create a timeout to reject promise if not resolved
      var timer = setTimeout(function () {
        cleared = true;
        reject(new Error(`[${module.name}] module failed to start in the allowed time!`));
      }, app.options.moduleStartTimeout);

      promise
        .then(function (res) {
          // If already cleared, the response is too late, we must not do anything
          if (!cleared) {
            clearTimeout(timer);
            resolve(res);
          }
        })
        .catch(function (err) {
          if (!cleared) {
            clearTimeout(timer);
            reject(err);
          }
        });
    });



  }

  function setUpRequiredDependencies(module, appModule) {
    const requiredModules = typeof appModule.requiredModules === 'string'
      ? appModule.requiredModules.split(' ')
      : appModule.requiredModules;

    if (!Array.isArray(requiredModules)) {
      return;
    }

    requiredModules.forEach(moduleProperty => {
      const requiredModuleName = module.config[`${moduleProperty}Id`];
      const requiredModule = app[requiredModuleName];

      if (!requiredModule) {
        throw new Error(`[${module.name}] module requires the [${moduleProperty}] module!`);
      }

      module[moduleProperty] = requiredModule;
    });
  }

  function setUpOptionalDependencies(module, appModule) {
    Object.keys(appModule.optionalModules || {}).forEach(optionalModules => {
      const setUpFunctions = appModule.optionalModules[optionalModules];
      const deps = new Map();

      optionalModules.split(' ').forEach(depModuleProperty => {
        deps.set(depModuleProperty, module.config[`${depModuleProperty}Id`]);
      });

      app.onModuleReady(Array.from(deps.values()), () => {
        deps.forEach((depModuleName, depModuleProperty) => {
          module[depModuleProperty] = app[depModuleName];
        });

        if (Array.isArray(setUpFunctions)) {
          setUpFunctions.forEach(setUp => setUp(app, module));
        }
        else if (typeof setUpFunctions === 'function') {
          setUpFunctions(app, module);
        }
      });
    });
  }

  /**
   * @private
   * @param {Array.<function>} startModules
   * @param {Object} module
   * @param {Object} appModule
   * @returns {function((Error|null))}
   */
  function createStartModuleStep(startModules, module, appModule) {
    return async function startModuleStep() {
      module.info(`Starting ${module.name} ...`);

      app.main.startedModules.push(module.name);

      app[module.name] = module;

      app.broker.publish('app.modules.starting', { module, appModule });
      try {
        if (appModule.start && appModule.start.length === 3) {
          await startModuleAsync(module, appModule);
        }
        else {
          await startModuleSync(module, appModule);
        }
      } catch (error) {
        module.error(err.stack || err.message || err);
      }

    };
  }

  /**
   * @private
   * @param {Array.<function>} startModules
   * @param {Object} module
   */
  function addStartModule(startModules, module) {
    const moduleName = module.name;

    app.logger.extend(module, {
      module: moduleName
    });

    module.info(`Setting up ${moduleName} ...`);
    const appModule = require( module.path );
    if (appModule === null || typeof appModule !== 'object') {
      module.info(`Skipping empty module ${moduleName} .`);
      return;
    }
    if (!module.config) {
      module.config = {};
    }

    if (appModule.DEFAULT_CONFIG != null) {
      Object.keys(appModule.DEFAULT_CONFIG).forEach(configKey => {
        if (module.config[configKey] === undefined) {
          module.config[configKey] = appModule.DEFAULT_CONFIG[configKey];
        }
      });
    }

    app.main.modules[moduleName] = module;
    app.main.appModules[moduleName] = appModule;

    app.broker.publish('app.modules.settingUp', { module, appModule });

    if (typeof appModule.setUp === 'function') {
      appModule.setUp(app, module);
    }

    app.broker.publish('app.modules.setUp', { module, appModule });

    if (typeof appModule.onModuleSetUp === 'function') {
      app.main.setUpModules.forEach(moduleName => {
        appModule.onModuleSetUp(app, {
          moduleName,
          module,
          appModule,
          setUpModule: app.main.modules[moduleName],
          setUpAppModule: app.main.appModules[moduleName]
        });
      });

      app.broker.subscribe('app.modules.setUp', m => {
        appModule.onModuleSetUp(app, {
          module,
          appModule,
          setUpModule: m.module,
          setUpAppModule: m.appModule
        });
      });
    }

    app.main.setUpModules.push(moduleName);

    startModules.push(createStartModuleStep(
      startModules, module, appModule
    ));
  }

  async function startUp() {
    app.info(`Starting ${app.options.id} ...`);
    const startModules = [];
    modules.forEach(addStartModule.bind(null, startModules));

    for (let index = 0; index < startModules.length; index++) {
      await startModules[index]();
    }
    const env = app.options.env;
    const time = Date.now() - app.options.startTime;

    app.info(`Started ${app.options.id}.`, { env, startTime: time });

    app.broker.publish('app.started', {
      id: app.options.id,
      env,
      time
    });

  }


  startUp().catch(err => {
    console.log(err.stack || err.message || err);
  })


};
