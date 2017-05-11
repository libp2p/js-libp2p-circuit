/* eslint-env mocha */
'use strict'

const Listener = require('../src/listener')
const nodes = require('./fixtures/nodes')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const multiaddr = require('multiaddr')
const expect = require('chai').expect

describe('listener', function () {
  describe(`getAddrs`, function () {
    let swarm = null
    let listener = null
    let peerInfo = null

    beforeEach(function (done) {
      waterfall([
        (cb) => PeerId.createFromJSON(nodes.node4, cb),
        (peerId, cb) => PeerInfo.create(peerId, cb),
        (peer, cb) => {
          swarm = {
            _peerInfo: peer
          }

          peerInfo = peer
          listener = Listener(swarm, {}, () => {})
          cb()
        }
      ], done)
    })

    afterEach(() => {
      peerInfo = null
    })

    it(`should return correct addrs`, function () {
      peerInfo.multiaddrs.add(`/ip4/0.0.0.0/tcp/4002`)
      peerInfo.multiaddrs.add(`/ip4/127.0.0.1/tcp/4003/ws`)

      listener.getAddrs((err, addrs) => {
        expect(err).to.be.null
        expect(addrs).to.deep.equal([
          multiaddr(`/p2p-circuit/ip4/0.0.0.0/tcp/4002/ipfs/QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`),
          multiaddr(`/p2p-circuit/ip4/127.0.0.1/tcp/4003/ws/ipfs/QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`)])
      })
    })

    it(`don't return default addrs in an explicit p2p-circuit addres`, function () {
      peerInfo.multiaddrs.add(`/ip4/127.0.0.1/tcp/4003/ws`)
      peerInfo.multiaddrs.add(`/p2p-circuit/ip4/0.0.0.0/tcp/4002`)
      listener.getAddrs((err, addrs) => {
        expect(err).to.be.null
        expect(addrs[0]
          .toString())
          .to.equal(`/p2p-circuit/ip4/0.0.0.0/tcp/4002/ipfs/QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`)
      })
    })
  })
})
