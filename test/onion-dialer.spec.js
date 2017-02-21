/* eslint-env mocha */
'use strict'

const Dialer = require('../src/circuit/onion-dialer')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const multiaddr = require('multiaddr')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const waterfall = require('async/waterfall')

const sinon = require('sinon')
const expect = require('chai').expect

describe('onion dialer tests', function () {
  describe('dial', function () {
    const dialer = sinon.createStubInstance(Dialer)

    beforeEach(function (done) {
      waterfall([
        (cb) => PeerId.createFromJSON(nodes.node4, cb),
        (peerId, cb) => PeerInfo.create(peerId, cb),
        (peer, cb) => {
          dialer.swarm = {
            _peerInfo: peer
          }
          cb()
        }
      ], done)

      dialer.dial.callThrough()
    })

    afterEach(function () {
      dialer.dial.reset()
      dialer._onionDial.reset()
    })

    it(`split the multiaddr correctly`, function (done) {
      dialer._onionDial.callsArgWith(1, null, new Connection())

      const chainedAddr = multiaddr(
        `/ip4/0.0.0.0/tcp/9033/ws/ipfs/${nodes.node2.id}/p2p-circuit` +
        `/ip4/0.0.0.0/tcp/9031/ipfs/${nodes.node1.id}/p2p-circuit/`)

      dialer.dial(chainedAddr + `/ipfs/${nodes.node3.id}`, (err, conn) => {
        expect(err).to.be.null
        expect(dialer._onionDial.calledOnce).to.be.ok
        expect(dialer._onionDial.calledWith([
          `/ip4/0.0.0.0/tcp/9033/ws/ipfs/${nodes.node2.id}`,
          `/ip4/0.0.0.0/tcp/9031/ipfs/${nodes.node1.id}`,
          `/ipfs/${nodes.node3.id}`
        ])).to.be.ok
        done()
      })
    })

    it(`not dial to itself`, function (done) {
      const chainedAddr = multiaddr(
        `/ip4/0.0.0.0/tcp/9033/ws/ipfs/${nodes.node2.id}/p2p-circuit` +
        `/ip4/0.0.0.0/tcp/9031/ipfs/${nodes.node1.id}/p2p-circuit/`)

      dialer.dial(chainedAddr + `/ipfs/${nodes.node4.id}`, (err, conn) => {
        expect(err).to.not.be.null
        expect(err).to.be.equal(`cant dial to self!`)
        expect(dialer._onionDial.calledOnce).to.not.be.ok
        done()
      })
    })
  })

  describe('_onionDial', function () {
    describe('_onionDial chained address', function () {
      const dialer = sinon.createStubInstance(Dialer)
      dialer.relayPeers = new Map()

      let swarm = null
      let upgraded = null
      beforeEach(function (done) {
        waterfall([
          (cb) => PeerId.createFromJSON(nodes.node4, cb),
          (peerId, cb) => PeerInfo.create(peerId, cb),
          (peer, cb) => {
            swarm = {
              _peerInfo: peer,
              _peerBook: {
                get: () => new PeerInfo(PeerId.createFromB58String('QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')),
                has: () => true
              }
            }
            dialer.swarm = swarm
            cb()
          },
          (cb) => {
            upgraded = new Connection()
            dialer._onionDial.callThrough()
            dialer.dialPeer.onCall(0).callsArgWith(2, null, new Connection())
            dialer._createRelayPipe.onCall(0).callsArgWith(2, null, upgraded)
            dialer.dialPeer.onCall(1).callsArgWith(2, null, new Connection())
            cb()
          }
        ], done)
      })

      afterEach(function () {
        dialer.dial.reset()
        dialer.dialRelay.reset()
      })

      it(`dial chained multiaddr correctly`, function (done) {
        const chainedAddrs = [
          `/ip4/0.0.0.0/tcp/9033/ws/ipfs/${nodes.node2.id}`,
          `/ip4/0.0.0.0/tcp/9031/ipfs/${nodes.node1.id}`,
          `/ipfs/${nodes.node3.id}`
        ]

        const addr1 = multiaddr(chainedAddrs[0])
        const addr2 = multiaddr(chainedAddrs[1])
        const addr3 = multiaddr(chainedAddrs[2])

        dialer._onionDial(chainedAddrs, (err, conn) => {
          expect(err).to.be.null
          expect(dialer._createRelayPipe.calledWith(addr2, addr1)).to.be.ok
          expect(dialer.dialPeer.calledWith(addr3, upgraded)).to.be.ok
          done()
        })
      })
    })

    describe('_onionDial non chained address', function () {
      const dialer = sinon.createStubInstance(Dialer)
      dialer.relayPeers = new Map()

      let swarm
      beforeEach(function (done) {
        waterfall([
          (cb) => PeerId.createFromJSON(nodes.node4, cb),
          (peerId, cb) => PeerInfo.create(peerId, cb),
          (peer, cb) => {
            swarm = {
              _peerInfo: peer,
              _peerBook: {
                get: () => new PeerInfo(PeerId.createFromB58String('QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')),
                has: () => true
              }
            }
            dialer.swarm = swarm
            cb()
          },
          (cb) => {
            dialer._onionDial.callThrough()
            dialer.dialPeer.onCall(0).callsArgWith(2, null, new Connection())
            cb()
          }
        ], done)
      })

      afterEach(function () {
        dialer.dial.reset()
        dialer.dialRelay.reset()
      })

      it(`dial chained multiaddr correctly`, function (done) {
        dialer._onionDial([`/ip4/0.0.0.0/tcp/9033/ws/ipfs/${nodes.node2.id}`], (err, conn) => {
          expect(err).to.be.null
          expect(dialer.dialPeer.calledWith(multiaddr(`/ip4/0.0.0.0/tcp/9033/ws/ipfs/${nodes.node2.id}`))).to.be.ok
          done()
        })
      })
    })
  })
})
