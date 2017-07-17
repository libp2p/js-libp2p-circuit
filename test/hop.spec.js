/* eslint-env mocha */
'use strict'

const Hop = require('../src/circuit/hop')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const handshake = require('pull-handshake')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const lp = require('pull-length-prefixed')
const proto = require('../src/protocol')
const StreamHandler = require('../src/circuit/stream-handler')

const sinon = require('sinon')
const expect = require('chai').expect

describe('relay', function () {
  describe(`handle circuit requests`, function () {
    let relay
    let swarm
    let fromConn
    let stream
    let shake

    beforeEach(function (done) {
      stream = handshake({timeout: 1000 * 60})
      shake = stream.handshake
      fromConn = new Connection(stream)
      fromConn.setPeerInfo(new PeerInfo(PeerId.createFromB58String('QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA')))

      waterfall([
        (cb) => PeerId.createFromJSON(nodes.node4, cb),
        (peerId, cb) => PeerInfo.create(peerId, cb),
        (peer, cb) => {
          peer.multiaddrs.add('/p2p-circuit/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')
          swarm = {
            _peerInfo: peer,
            conns: {
              QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE: new Connection()
            }
          }

          cb()
        }
      ], () => {
        relay = new Hop(swarm, {enabled: true})
        relay._circuit = sinon.stub()
        relay._circuit.callsArg(2, null, new Connection())
        done()
      })
    })

    afterEach(() => {
      relay._circuit.reset()
    })

    it(`handle a valid circuit request`, function (done) {
      let relayMsg = {
        type: proto.CircuitRelay.Type.HOP,
        srcPeer: {
          id: `QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`,
          addrs: [`/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`]
        },
        dstPeer: {
          id: `QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA`,
          addrs: [`/ipfs/QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA`]
        }
      }

      relay.on('circuit:success', () => {
        expect(relay._circuit.calledWith(sinon.match.any, relayMsg)).to.be.ok
        done()
      })

      relay.handle(relayMsg, new StreamHandler(fromConn))
    })

    it(`not dial to self`, function (done) {
      let relayMsg = {
        type: proto.CircuitRelay.Type.HOP,
        srcPeer: {
          id: `QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`,
          addrs: [`/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`]
        },
        dstPeer: {
          id: `QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`,
          addrs: [`/ipfs/QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`]
        }
      }

      lp.decodeFromReader(shake, (err, msg) => {
        expect(err).to.be.null

        const response = proto.CircuitRelay.decode(msg)
        expect(response.code).to.equal(proto.CircuitRelay.Status.HOP_CANT_RELAY_TO_SELF)
        expect(response.type).to.equal(proto.CircuitRelay.Type.STATUS)
        done()
      })

      relay.handle(relayMsg, new StreamHandler(fromConn))
    })

    it(`fail on invalid src address`, function (done) {
      let relayMsg = {
        type: proto.CircuitRelay.Type.HOP,
        srcPeer: {
          id: `sdfkjsdnfkjdsb`,
          addrs: [`sdfkjsdnfkjdsb`]
        },
        dstPeer: {
          id: `QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA`,
          addrs: [`/ipfs/QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA`]
        }
      }

      lp.decodeFromReader(shake, (err, msg) => {
        expect(err).to.be.null

        const response = proto.CircuitRelay.decode(msg)
        expect(response.code).to.equal(proto.CircuitRelay.Status.HOP_SRC_MULTIADDR_INVALID)
        expect(response.type).to.equal(proto.CircuitRelay.Type.STATUS)
        done()
      })

      relay.handle(relayMsg, new StreamHandler(fromConn))
    })

    it(`fail on invalid dst address`, function (done) {
      let relayMsg = {
        type: proto.CircuitRelay.Type.HOP,
        srcPeer: {
          id: `QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA`,
          addrs: [`/ipfs/QmQWqGdndSpAkxfk8iyiJyz3XXGkrDNujvc8vEst3baubA`]
        },
        dstPeer: {
          id: `sdfkjsdnfkjdsb`,
          addrs: [`sdfkjsdnfkjdsb`]
        }
      }

      lp.decodeFromReader(shake, (err, msg) => {
        expect(err).to.be.null

        const response = proto.CircuitRelay.decode(msg)
        expect(response.code).to.equal(proto.CircuitRelay.Status.HOP_DST_MULTIADDR_INVALID)
        expect(response.type).to.equal(proto.CircuitRelay.Type.STATUS)
        done()
      })

      relay.handle(relayMsg, new StreamHandler(fromConn))
    })
  })
})
