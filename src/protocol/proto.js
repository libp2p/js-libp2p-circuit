'use strict'
module.exports = `
message Circuit {
  optional string version = 1;
  optional RelayMessage message = 2;
  
  enum MessageType {
    HOP = 1;
    STOP = 2;
  }
  
  message Peer {
    optional string id = 1; // peer id
    repeated string address = 2; // peer's dialable addresses      
  }
  
  message RelayMessage {
    optional MessageType type = 1;
    optional Peer source = 2;
    optional Peer dest = 3;
  }
}
`
