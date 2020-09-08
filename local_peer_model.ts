type NetworkTime = number
type NetworkID = string
type NetworkMessage = string

// interface GoMeshAPI { // is now separated into Swifts APIFuncs and APICallbacks
//   GetMyID(): string
//   SendMessage(id: string, data: string): void
//   RegisterMessageHandler(callback: (id: NetworkID, data: NetworkMessage) => void): void
//   RegisterPeerAppearedHandler(callback: (id: NetworkID) => void): void
//   RegisterPeerDisappearedHandler(callback: (id: NetworkID) => void): void
//   RegisterTimeTickHandler(callback: (ts: NetworkTime) => void): void
// }

interface SwiftMeshAPIFuncs {

  /// 0
  myID(): NetworkID

  /// 4
  sendToPeer(peerID: NetworkID, data: NetworkMessage): void

}

interface SwiftMeshAPICallbacks {

  /// 1
  tick(ts: NetworkTime): void

  /// 2
  foundPeer(peerID: NetworkID): void
  /// 3
  lostPeer(peerID: NetworkID): void

  /// 5
  didReceiveFromPeer(peerID: NetworkID, data: NetworkMessage): void

}

class pkgStateUpdate {
  TS: NetworkTime
  Data: any // json.RawMessage
}

class pkgStateUpdateReceivedAck {
  TS: NetworkTime
}

class pkg {
  Type: string
  Content: any // json.RawMessage

  constructor(Type: string, Content: any) {
    this.Type = Type
    this.Content = Content
  }
}

class debugDataStruct {
  MyID: NetworkID
  MyTS: NetworkTime
  PeersState: { [key: string]: peerState } // map[NetworkID]peerState

  constructor(MyID: NetworkID, MyTS: NetworkTime, PeersState: { [key: string]: peerState }) {
    this.MyID = MyID
    this.MyTS = MyTS
    this.PeersState = PeersState
  }
}

class peerToPeerSyncer {
  lastAttemptTS: NetworkTime
  lastTickTime: NetworkTime
  synced: boolean
  delay: NetworkTime
  sender: (pkg: pkgStateUpdate) => void

  updatePkg: pkgStateUpdate

  updateData(data: any) {
    this.synced = false
    this.lastAttemptTS = 0
    this.updatePkg.Data = data
    this.updatePkg.TS = this.lastTickTime

    this.tick(this.lastTickTime)
  }

  tick(ts: NetworkTime) {
    if (!this.synced && ts - this.lastAttemptTS >= this.delay) {
      this.lastAttemptTS = ts
      this.sender(this.updatePkg)
    }
    this.lastTickTime = ts
  }

  handleAck(ackPkg: pkgStateUpdateReceivedAck) {
    if (this.synced) {
      return
    }
    if (ackPkg.TS == this.updatePkg.TS) {
      this.synced = true
    }
  }

  constructor(sender: (pkg: pkgStateUpdate) => void) {
    this.lastAttemptTS = 0
    this.lastTickTime = 0
    this.synced = true
    this.delay = 30000
    this.sender = sender
    this.updatePkg = new pkgStateUpdate()
  }
}

// PeerUserState contains user data
class PeerUserState {
  Coordinates: number[]
  Message: string

  constructor(Message: string) {
    this.Message = Message
  }
}

class peerState {
  UserState: PeerUserState
  UpdateTS: NetworkTime

  constructor(UserState: PeerUserState, UpdateTS: NetworkTime) {
    this.UserState = UserState
    this.UpdateTS = UpdateTS
  }
}

// SimplePeer1 provides simplest flood peer strategy
class SimplePeer1 implements SwiftMeshAPICallbacks {

  api: SwiftMeshAPIFuncs
  // logger:  *log.Logger
  Label: string
  syncers: { [key: string]: peerToPeerSyncer } // key: NetworkID

  meshNetworkState: { [key: string]: peerState } // key: NetworkID

  // easyMeshNetworkState(): { [key: string]: string } { // returns { [key: NetworkID]: NetworkMessage }
  //   this.meshNetworkState.map()
  // }

  currentTS: NetworkTime

  nextSendTime: NetworkTime

  // HandleAppearedPeer implements crowd.MeshActor
  foundPeer(peerID: NetworkID) { this.handleAppearedPeer(peerID) }
  handleAppearedPeer(id: NetworkID) {
    this.syncers[id] = new peerToPeerSyncer((d: pkgStateUpdate) => {

      let bt = JSON.stringify(d)
      if (bt == null) {
        console.log("err.Error()")
        return
      }

      let p = new pkg("pkgStateUpdate", bt)

      let bt2 = JSON.stringify(p)
      if (bt2 == null) {
        console.log("err.Error()")
        return
      }
      // this.api.sendToPeer(id, bt2)
      (self as any).sendToPeer(id, bt2)
    })

    if (Object.keys(this.meshNetworkState).length > 0) {
      let serialisedState = JSON.stringify(this.meshNetworkState)
      if (serialisedState == null) {
        console.log("err.Error()")
        return
      }

      this.syncers[id].updateData(serialisedState)
    }
  }

  lostPeer(peerID: NetworkID) { this.handleDisappearedPeer(peerID) }
  handleDisappearedPeer(id: NetworkID) {
    delete this.syncers[id]
  }

  sendDbgData() { // pass
    //     this.api.SendDebugData(new debugDataStruct(
    //         this.api.GetMyID(),
    //         this.currentTS,
    //         this.meshNetworkState
    //     ))
  }

  handleNewIncomingState(sourceID: NetworkID, update: pkgStateUpdate) {
    let newNetworkState = JSON.parse(update.Data) as { [key: string]: peerState }
    let somethingChanged = false

    if (newNetworkState != null) {
      for (let key in newNetworkState) {
        let newPeerState = newNetworkState[key]

        let existingPeerState = this.meshNetworkState[key]

        if (existingPeerState == null) {
          somethingChanged = true
          this.meshNetworkState[key] = newPeerState
        } else {
          if (existingPeerState.UpdateTS < newPeerState.UpdateTS) {
            somethingChanged = true
            this.meshNetworkState[key] = newPeerState
          }
        }
      }
    } else {
      console.log("err.Error()")
      return
    }

    if (somethingChanged) {
      this.sendDbgData()

      let serialisedState = JSON.stringify(this.meshNetworkState)

      if (serialisedState == null) {
        console.log("err.Error()")
        return
      }

      for (let key in this.syncers) {
        let syncer = this.syncers[key]
        if (sourceID == key) {
          continue
        }
        syncer.updateData(serialisedState)
      }
    }
  }

  didReceiveFromPeer(peerID: NetworkID, data: NetworkMessage) { this.handleMessage(peerID, data) }
  handleMessage(id: NetworkID, data: NetworkMessage) {
    // let inpkg = new pkg()
    let inpkg = JSON.parse(data) as pkg // Unmarshal

    if (inpkg == null) {
      console.log("err.Error()")
      return
    }

    switch (inpkg.Type) {
      case "pkgStateUpdate":

        let update = JSON.parse(inpkg.Content) as pkgStateUpdate // Unmarshal

        this.handleNewIncomingState(id, update)

        let ack = new pkgStateUpdateReceivedAck()
        ack.TS = update.TS

        let ser = JSON.stringify(ack) // Marshal
        let p1 = new pkg("pkgStateUpdateReceivedAck", ser)

        let bt2 = JSON.stringify(p1)
        if (bt2 == null) {
          console.log("err.Error()")
          return
        }
        this.api.sendToPeer(id, bt2)
        break

      case "pkgStateUpdateReceivedAck":
        let p2 = this.syncers[id]
        if (p2 != null) {
          let ack = JSON.parse(inpkg.Content) as pkgStateUpdateReceivedAck
          p2.handleAck(ack)
        }
        break
    }
  }

  tick(ts: NetworkTime) { this.handleTimeTick(ts) }
  handleTimeTick(ts: NetworkTime) {
    this.currentTS = ts
    for (let key in this.syncers) {
      let syncer = this.syncers[key]
      syncer.tick(ts)
    }

    if (this.currentTS > this.nextSendTime) {
      this.nextSendTime = this.currentTS + (3000000 + randomIntFromInterval(0, 5000000))
      this.SetState(new PeerUserState(this.Label + " says " + this.currentTS / 1000))
    }
  }

  constructor(label: string, api: SwiftMeshAPIFuncs) {
    this.api = api
    this.Label = label
    this.syncers = {}
    this.meshNetworkState = {}

    // api.RegisterMessageHandler((id: NetworkID, data: NetworkMessage) => {
    //     this.handleMessage(id, data)
    // })
    // api.RegisterPeerAppearedHandler((id: NetworkID) => {
    //     this.handleAppearedPeer(id)
    // })
    // api.RegisterPeerDisappearedHandler((id: NetworkID) => {
    //     this.handleDisappearedPeer(id)
    // })
    // api.RegisterTimeTickHandler((ts: NetworkTime) => {
    //     this.(ts)
    // })
  }

  // SetState updates this peer user data
  SetState(p: PeerUserState) {
    this.meshNetworkState[this.Label] = new peerState(p, this.currentTS)
    this.sendDbgData()

    let serialisedState = this.meshNetworkState

    for (let key in this.syncers) {
      let syncer = this.syncers[key]
      syncer.updateData(serialisedState)
    }
  }

}

function randomIntFromInterval(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

let simplePeerInstance: SimplePeer1

function letsgo(label: string, api: SwiftMeshAPIFuncs) {
  simplePeerInstance = new SimplePeer1(label, api)
  return simplePeerInstance
}

// --

function tick(ts: NetworkTime) {
  
  if (!!simplePeerInstance) {
    simplePeerInstance.handleTimeTick(ts)

    return "ok js' ticked " + ts
  }

  return "tick can't find simplePeerInstance "
}

function foundPeer(peerID: NetworkID) {
  simplePeerInstance.handleAppearedPeer(peerID)
}

function lostPeer(peerID: NetworkID) {
  simplePeerInstance.handleDisappearedPeer(peerID)
}

function didReceiveFromPeer(peerID: NetworkID, data: NetworkMessage) {
  simplePeerInstance.handleMessage(peerID, data)
}

function isendmessage(text: NetworkMessage) { 
  simplePeerInstance.SetState(new PeerUserState(text)) 
}
