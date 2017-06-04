/* eslint-env mocha */
'use strict'

const Hop = require('../src/circuit/hop')
const Dialer = require('../src/circuit/dialer')
const nodes = require('./fixtures/nodes')
const Connection = require('interface-connection').Connection
const multiaddr = require('multiaddr')
const multicodec = require('../src/multicodec')
const constants = require('../src/circuit/constants')
const handshake = require('pull-handshake')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const longaddr = require('./fixtures/long-address')

const sinon = require('sinon')
const expect = require('chai').expect

describe('relay', function () {
  describe(`handle circuit requests`, function () {
    const dialer = sinon.createStubInstance(Dialer)

    let relay
    let swarm
    let fromConn
    let toConn
    let stream
    let shake
    let handlerSpy

    beforeEach(function (done) {
      stream = handshake({timeout: 1000 * 60})
      shake = stream.handshake
      fromConn = new Connection(stream)
      fromConn.setPeerInfo(new PeerInfo(PeerId.createFromB58String('QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE')))
      toConn = new Connection(shake.rest())

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

          dialer.swarm = swarm
          cb()
        }
      ], () => {
        relay = new Hop({enabled: true})
        relay.mount(swarm) // mount the swarm
        relay._circuit = sinon.stub()
        relay._circuit.callsArg(3, null, toConn)

        dialer.relayConns = new Map()
        dialer.negotiateRelay.callThrough()
        done()
      })
    })

    afterEach(() => {
      relay._circuit.reset()
    })

    it(`handle a valid circuit request`, function (done) {
      relay.active = true
      relay.on('circuit:success', () => {
        expect(relay._circuit.calledWith(sinon.match.any, dstMa)).to.be.ok
        done()
      })

      let dstMa = multiaddr(`/ip4/0.0.0.0/tcp/9033/ws/ipfs/QmSswe1dCFRepmhjAMR5VfHeokGLcvVggkuDJm7RMfJSrE`)
      dialer.negotiateRelay(fromConn, dstMa, () => {})
      handlerSpy(multicodec.hop, toConn)
    })

    // it(`fail dialing to invalid multiaddr`, function () {
    //   // TODO: implement without relying on negotiateRelay
    // })

    it(`not dial to self`, function (done) {
      let dstMa = multiaddr(`/ipfs/${nodes.node4.id}`)
      dialer.negotiateRelay(fromConn, dstMa, (err, newConn) => {
        expect(err).to.not.be.null
        expect(err).to.be.an.instanceOf(Error)
        expect(err.message)
          .to
          .equal(`Got ${constants.RESPONSE.HOP.CANT_CONNECT_TO_SELF} error code trying to dial over relay`)
        expect(newConn).to.be.undefined
        done()
      })

      handlerSpy(multicodec.hop, toConn)
    })

    it(`fail on address exceeding 1024 bytes`, function (done) {
      let dstMa = multiaddr(longaddr.toString())
      dialer.negotiateRelay(fromConn, dstMa, (err, newConn) => {
        expect(err).to.not.be.null
        expect(err).to.be.an.instanceOf(Error)
        expect(err.message)
          .to
          .equal(`Got ${constants.RESPONSE.HOP.DST_ADDR_TOO_LONG} error code trying to dial over relay`)
        expect(newConn).to.be.undefined
        done()
      })

      handlerSpy(multicodec.hop, toConn)
    })
  })
})
