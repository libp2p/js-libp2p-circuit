/* eslint-env mocha */
'use strict'

const Stop = require('../src/circuit/stop')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const constants = require('../src/circuit/constants')
const handshake = require('pull-handshake')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const lp = require('pull-length-prefixed')
const pull = require('pull-stream')
const longaddr = require('./fixtures/long-address')

const expect = require('chai').expect

describe('stop', function () {
  describe(`handle relayed connections`, function () {
    let stopHandler

    let swarm
    let conn
    let stream
    let shake

    beforeEach(function (done) {
      stream = handshake({timeout: 1000 * 60})
      shake = stream.handshake
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
      pull(
        pull.values([Buffer.from(`/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`)]),
        lp.encode(),
        pull.collect((err, encoded) => {
          expect(err).to.be.null

          shake.write(encoded[0])
          lp.decodeFromReader(shake, (err, msg) => {
            expect(err).to.be.null
            expect(msg.toString()).to.equal(String(constants.RESPONSE.SUCCESS))
            done()
          })
        })
      )
      stopHandler.handle(conn)
    })

    it(`handle request with invalid multiaddress`, function (done) {
      pull(
        pull.values([Buffer.from(`sdfsddfds`)]),
        lp.encode(),
        pull.collect((err, encoded) => {
          expect(err).to.be.null

          shake.write(encoded[0])
          lp.decodeFromReader(shake, (err, msg) => {
            expect(err).to.be.null
            expect(msg.toString()).to.equal(String(constants.RESPONSE.STOP.SRC_MULTIADDR_INVALID))
            done()
          })
        })
      )
      stopHandler.handle(conn)
    })

    it(`handle request with a long multiaddress`, function (done) {
      pull(
        pull.values([longaddr]),
        lp.encode(),
        pull.collect((err, encoded) => {
          expect(err).to.be.null

          shake.write(encoded[0])
          lp.decodeFromReader(shake, (err, msg) => {
            expect(err).to.be.null
            expect(msg.toString()).to.equal(String(constants.RESPONSE.STOP.SRC_ADDR_TOO_LONG))
            done()
          })
        })
      )
      stopHandler.handle(conn)
    })
  })
})
