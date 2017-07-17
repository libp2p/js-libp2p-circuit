/* eslint-env mocha */
'use strict'

const expect = require('chai').expect

const proto = require('../src/protocol')

describe('protocol', function () {
  let msgObject = null
  let message = null

  before(() => {
    msgObject = {
      type: proto.CircuitRelay.Type.HOP,
      srcPeer: {
        id: 'QmSource',
        addrs: [
          '/p2p-circuit/ipfs/QmSource',
          '/p2p-circuit/ipv4/0.0.0.0/9000/ipfs/QmSource',
          'ipv4/0.0.0.0/9000/ipfs/QmSource'
        ]
      },
      dstPeer: {
        id: 'QmDest',
        addrs: [
          '/p2p-circuit/ipfs/QmDest',
          '/p2p-circuit/ipv4/1.1.1.1/9000/ipfs/QmDest',
          'ipv4/1.1.1.1/9000/ipfs/QmDest'
        ]
      }
    }

    let buff = proto.CircuitRelay.encode(msgObject)
    message = proto.CircuitRelay.decode(buff)
  })

  it(`should source and dest`, () => {
    expect(message.srcPeer).to.not.be.null
    expect(message.dstPeer).to.not.be.null
  })

  it(`should encode message`, () => {
    expect(message.message).to.deep.equal(msgObject.message)
  })
})
