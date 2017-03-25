'use strict'
const debug = require('debug')

const log = debug('libp2p:circuit:utils')
log.err = debug('libp2p:circuit:error:utils')

function getDstAddrAsString (peerInfo) {
  return getStrAddress(peerInfo)
}

function getSrcAddrAsString (peerInfo) {
  return getStrAddress(peerInfo)
}

function getCircuitStrAddr (srcPeer, dstPeer) {
  return `${getSrcAddrAsString(srcPeer)}/p2p-circuit/${getDstAddrAsString(dstPeer)}`
}

function getStrAddress (peerInfo) {
  let addrs = peerInfo.distinctMultiaddr()

  if (!(addrs && addrs.length > 0)) {
    log.err(`No valid multiaddress for peer!`)
    return null
  }

  // pick the first address from the available multiaddrs for now
  return `${addrs[0].toString()}/ipfs/${peerInfo.id.toB58String()}`
}

exports.getDstAddrAsString = getDstAddrAsString
exports.getSrcAddrAsString = getSrcAddrAsString
exports.getCircuitStrAddr = getCircuitStrAddr
exports.getStrAddress = getStrAddress
