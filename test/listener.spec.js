/* eslint-env mocha */
'use strict'

const Listener = require('../src/listener')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const multicodec = require('../src/multicodec')
const constants = require('../src/circuit/constants')
const handshake = require('pull-handshake')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const lp = require('pull-length-prefixed')
const pull = require('pull-stream')
const multiaddr = require('multiaddr')
const longaddr = require('./fixtures/long-address')

const sinon = require('sinon')
const expect = require('chai').expect

describe('listener', function () {
  describe(`listen for relayed connections`, function () {
    let listener

    let swarm
    let conn
    let stream
    let shake
    let handlerSpy

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
            handle: sinon.spy((proto, h) => {
              handlerSpy = sinon.spy(h)
            }),
            conns: {
              QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE: new Connection()
            }
          }

          listener = Listener(swarm, {}, () => {})
          listener.listen()
          cb()
        }
      ], done)
    })

    afterEach(() => {
      handlerSpy.reset()
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
      handlerSpy(multicodec.hop, conn)
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
      handlerSpy(multicodec.hop, conn)
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
      handlerSpy(multicodec.hop, conn)
    })
  })

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
