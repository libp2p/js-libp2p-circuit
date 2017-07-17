/* eslint-env mocha */
'use strict'

const Dialer = require('../src/circuit/dialer')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const multiaddr = require('multiaddr')
const handshake = require('pull-handshake')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const waterfall = require('async/waterfall')
const pull = require('pull-stream')
const lp = require('pull-length-prefixed')
const proto = require('../src/protocol')

const sinon = require('sinon')
const expect = require('chai').expect

describe('dialer tests', function () {
  describe('dialPeer', function () {
    const dialer = sinon.createStubInstance(Dialer)

    beforeEach(function () {
      dialer.relayPeers = new Map()
      dialer.relayPeers.set(nodes.node1.id, new Connection())
      dialer.relayPeers.set(nodes.node2.id, new Connection())
      dialer.relayPeers.set(nodes.node3.id, new Connection())
      dialer.dialPeer.callThrough()
    })

    afterEach(function () {
      dialer.negotiateRelay.reset()
    })

    it(`negotiate a circuit on all available relays`, function (done) {
      const dstMa = multiaddr(`/ipfs/${nodes.node4.id}`)
      dialer.negotiateRelay.callsFake(function (conn, dstMa, callback) {
        if (conn === dialer.relayPeers.get(nodes.node3.id)) {
          return callback(null, dialer.relayPeers.get(nodes.node3.id))
        }

        callback('error')
      })

      dialer.dialPeer(dstMa, (err, conn) => {
        expect(err).to.be.null
        expect(conn).to.be.an.instanceOf(Connection)
        expect(conn).to.deep.equal(dialer.relayPeers.get(nodes.node3.id))
        done()
      })
    })

    it(`try all available relays and fail with error if none succeed`, function (done) {
      const dstMa = multiaddr(`/ipfs/${nodes.node4.id}`)
      dialer.negotiateRelay.callsFake(function (conn, dstMa, callback) {
        callback('error')
      })

      dialer.dialPeer(dstMa, (err, conn) => {
        expect(conn).to.be.undefined
        expect(err).to.not.be.null
        expect(err).to.equal(`no relay peers were found or all relays failed to dial`)
        done()
      })
    })
  })

  describe('negotiateRelay', function () {
    const dialer = sinon.createStubInstance(Dialer)
    const dstMa = multiaddr(`/ipfs/${nodes.node4.id}`)

    let conn
    let stream
    let shake
    let callback = sinon.stub()

    beforeEach(function (done) {
      waterfall([
        (cb) => PeerId.createFromJSON(nodes.node4, cb),
        (peerId, cb) => PeerInfo.create(peerId, cb),
        (peer, cb) => {
          peer.multiaddrs.add('/p2p-circuit/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')
          dialer.swarm = {
            _peerInfo: peer
          }
          cb()
        },
        (cb) => {
          dialer.relayConns = new Map()
          dialer.negotiateRelay.callThrough()
          stream = handshake({timeout: 1000 * 60})
          shake = stream.handshake
          conn = new Connection()
          conn.setPeerInfo(new PeerInfo(PeerId.createFromB58String('QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')))
          conn.setInnerConn(stream)
          dialer.negotiateRelay(conn, dstMa, callback)
          cb()
        }
      ], done)
    })

    afterEach(() => {
      callback.reset()
    })

    it(`write the correct dst addr`, function (done) {
      lp.decodeFromReader(shake, (err, msg) => {
        shake.write(proto.CircuitRelay.encode({
          type: proto.CircuitRelay.Type.STATUS,
          code: proto.CircuitRelay.Status.SUCCESS
        }))
        expect(err).to.be.null
        expect(proto.CircuitRelay.decode(msg).dstPeer.addrs.toString()).to.be.equal(`${dstMa.toString()}`)
        done()
      })
    })

    it(`fail negotiating relay`, function (done) {
      callback.callsFake((err, msg) => {
        expect(err).to.not.be.null
        expect(err).to.be.an.instanceOf(Error)
        expect(err.message).to.be.equal(`Got 101 error code trying to dial over relay`)
        expect(callback.calledOnce).to.be.ok
        done()
      })

      lp.decodeFromReader(shake, (err, msg) => {
        if (err) return done(err)

        pull(
          pull.values([proto.CircuitRelay.encode({
            type: proto.CircuitRelay.Type.STATUS,
            code: proto.CircuitRelay.Status.INVALID_MSG_TYPE
          })]), // send arbitrary non 200 code
          lp.encode(),
          pull.collect((err, encoded) => {
            expect(err).to.be.null
            encoded.forEach((e) => shake.write(e))
          })
        )
      })
    })
  })

  // describe('dialRelay', function () {
  //
  // })
})
