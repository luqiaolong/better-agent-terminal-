#!/usr/bin/env node
// Headless RemoteServer entry — see electron/server-cli.ts for the implementation.
const path = require('path')
const fs = require('fs')
// In dev: dist-electron/ is a sibling of bin/ in the repo root.
// When packaged: bin/ is in app.asar.unpacked, server-cli.js is inside app.asar.
const local = path.join(__dirname, '../dist-electron/server-cli.js')
const packed = path.join(__dirname, '../../app.asar/dist-electron/server-cli.js')
require(fs.existsSync(local) ? local : packed)
