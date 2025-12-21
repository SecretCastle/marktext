/**
 * This file is used specifically and only for development. It installs
 * `vue-devtools`. There shouldn't be any need to modify this file,
 * but it can be used to extend your development environment.
 */

/* eslint-disable */
require('dotenv').config()

const { app, BrowserWindow } = require('electron')

// Install `vue-devtools`
app.on('ready', () => {
  const { default: installExtension, VUEJS_DEVTOOLS } = require('electron-devtools-installer')
  installExtension(VUEJS_DEVTOOLS)
    .then(() => {})
    .catch(err => {
      console.log('Unable to install `vue-devtools`: \n', err)
    })
})

// Open DevTools for all windows in development mode
app.on('browser-window-created', (event, window) => {
  window.webContents.once('did-finish-load', () => {
    window.webContents.openDevTools()
  })
})

/* eslint-enable */

// Require `main` process to boot app
require('./index')
