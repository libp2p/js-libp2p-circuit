'use strict'

const debug = require('debug')

const log = debug('libp2p:circuit')
log.err = debug('libp2p:circuit:error')

module.exports = {
  log: log,
  multicodec: '/ipfs/relay/circuit/1.0.0'
}
