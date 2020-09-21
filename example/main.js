'use strict';

var app = {
  options: {
    moduleStartTimeout: 2000,
    rootPath: process.cwd(),
    env: process.env.NODE_ENV || 'development',
    startTime: Date.now()
  }
};

var modules = [
  {name: 'sync1', path: './modules/sync', config: {a: 2}},
  {name: 'async', path: './modules/async'},
  {name: 'sync2', path: './modules/sync'},
  // Same as ./node_modules/npm-module
  {name: 'npm-module', path: 'npm-module'}
];


require('../lib')(app, modules);
//require('../lib').main(app, modules);

//const _main = `${__dirname}/../lib`
//console.log(_main)
//require(_main).main(app, modules);
//require(`${__dirname}/../lib`).main(app, modules);


/*

xclip -sel clip < ~/.ssh/id_rsa.pub

ssh -T git@github.com

git remote -v
origin	https://github.com/this1-it/h5.main.git (fetch)
origin	https://github.com/this1-it/h5.main.git (push)


git remote set-url origin git@github.com:this1-it/h5.main.git

*/