/* eslint-env mocha */
'use strict'

const Stop = require('../src/circuit/stop')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const handshake = require('pull-handshake')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const StreamHandler = require('../src/circuit/stream-handler')
const proto = require('../src/protocol')

const expect = require('chai').expect

describe('stop', function () {
  describe(`handle relayed connections`, function () {
    let stopHandler

    let swarm
    let conn
    let stream

    beforeEach(function (done) {
      stream = handshake({timeout: 1000 * 60})
      conn = new Connection(stream)
      conn.setPeerInfo(new PeerInfo(PeerId.createFromB58String('QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')))

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

          stopHandler = new Stop(swarm)
          cb()
        }
      ], done)
    })

    it(`handle a valid request`, function (done) {
      stopHandler.handle({
        type: proto.CircuitRelay.Type.STOP,
        srcPeer: {
          id: `QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`,
          addrs: [`/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`]
        },
        dstPeer: {
          id: `QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`,
          addrs: [`/ipfs/QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`]
        }
      }, new StreamHandler(conn), (conn) => {
        expect(conn).to.be.not.null
        done()
      })
    })

    it(`handle request with invalid multiaddress`, function (done) {
      stopHandler.handle({
        type: proto.CircuitRelay.Type.STOP,
        srcPeer: {
          id: `QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`,
          addrs: [`dsfsdfsdf`]
        },
        dstPeer: {
          id: `QmQvM2mpqkjyXWbTHSUidUAWN26GgdMphTh9iGDdjgVXCy`,
          addrs: [`sdflksdfndsklfnlkdf`]
        }
      }, new StreamHandler(conn), (err, conn) => {
        expect(err).to.be.not.null
        done()
      })
    })
  })
})
