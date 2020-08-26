class Greeter {
    greeting: string;

    constructor(message: string) {
        this.greeting = message;
    }

    greet() {
        return "Hello, " + this.greeting;
    }
}

let greeter = new Greeter("world");

type NetworkTime = number
type NetworkID = string
type MeshAPI = any // fixme


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
class SimplePeer1 {
    api: MeshAPI
    // logger:  *log.Logger
    Label: string
    syncers: { [key: string]: peerToPeerSyncer } // key: NetworkID

    meshNetworkState: { [key: string]: peerState } // key: NetworkID
    currentTS: NetworkTime

    nextSendTime: NetworkTime



    // HandleAppearedPeer implements crowd.MeshActor
    handleAppearedPeer(id: NetworkID) {
        this.syncers[id] = new peerToPeerSyncer((d: pkgStateUpdate) => {
            bt, err:= json.Marshal(d)
            if err != nil {
                console.log(err.Error())
                return
            }
            p:= pkg{ Type: "pkgStateUpdate", Content: bt }
            bt2, err := json.Marshal(p)
            if err != nil {
                console.log(err.Error())
                return
            }
            this.api.SendMessage(id, bt2)
        })

        if (len(this.meshNetworkState) > 0) {
            serialisedState, err := json.Marshal(this.meshNetworkState)
            if err != nil {
                console.log(err.Error())
                return
            }

            this.syncers[id].updateData(serialisedState)
        }
    }

    handleDisappearedPeer(id: NetworkID) {
        delete this.syncers[id]
    }

    sendDbgData() {
        this.api.SendDebugData(new debugDataStruct(
            this.api.GetMyID(),
            this.currentTS,
            this.meshNetworkState
        ))
    }


    handleNewIncomingState(sourceID: NetworkID, update: pkgStateUpdate) {
        newNetworkState:= make(map[NetworkID]peerState)
        somethingChanged:= false
        if err := json.Unmarshal(update.Data, & newNetworkState); err == nil {
            for id, newPeerState := range newNetworkState {
                if existingPeerState, ok := this.meshNetworkState[id]; !ok {
                    somethingChanged = true
                    this.meshNetworkState[id] = newPeerState
                } else {
                    if existingPeerState.UpdateTS < newPeerState.UpdateTS {
                        somethingChanged = true
                        this.meshNetworkState[id] = newPeerState
                    }
                }
            }
        } else {
            console.log(err.Error())
            return
        }

        if (somethingChanged) {
            this.sendDbgData()
            serialisedState, err := json.Marshal(this.meshNetworkState)
            if err != nil {
                console.log(err.Error())
                return
            }

            for id, syncer := range this.syncers {
                if sourceID == id {
                    continue
                }
                syncer.updateData(serialisedState)
            }
        }
    }

    handleMessage(id: NetworkID, data: NetworkMessage) {
        inpkg:= & pkg{ }
        err:= json.Unmarshal(data, inpkg)
        if err != nil {
            console.log(err.Error())
            return
        }

        switch inpkg.Type {
            case "pkgStateUpdate":
                update:= pkgStateUpdate{ }
                json.Unmarshal(inpkg.Content, & update)
                this.handleNewIncomingState(id, update)

                ack:= pkgStateUpdateReceivedAck{ }
                ack.TS = update.TS
                ser, _ := json.Marshal(ack)
                p:= pkg{ Type: "pkgStateUpdateReceivedAck", Content: ser }
                bt2, err := json.Marshal(p)
                if err != nil {
                    console.log(err.Error())
                    return
                }
                this.api.SendMessage(id, bt2)
                break
            case "pkgStateUpdateReceivedAck":
                if p, ok := this.syncers[id]; ok {
                    ack:= pkgStateUpdateReceivedAck{ }
                    json.Unmarshal(inpkg.Content, & ack)
                    p.handleAck(ack)
                }
                break
        }
    }


    handleTimeTick(ts: NetworkTime) {
        this.currentTS = ts
        for _, s := range this.syncers {
            s.tick(ts)
        }

        if this.currentTS > this.nextSendTime {
            this.nextSendTime = this.currentTS + NetworkTime(3000000 + rand.Int63n(5000000))
            this.SetState(PeerUserState{ Message: fmt.Sprintf("%v says %v", this.Label, this.currentTS / 1000) })
        }
    }


    // NewSimplePeer1 returns new SimplePeer
    constructor(label: string, api: MeshAPI) {
        this.api = api
        this.Label = label
        this.syncers = {}
        this.meshNetworkState = {}

        api.RegisterMessageHandler(func(id NetworkID, data NetworkMessage) {
            ret.handleMessage(id, data)
        })
        api.RegisterPeerAppearedHandler(func(id NetworkID) {
            ret.handleAppearedPeer(id)
        })
        api.RegisterPeerDisappearedHandler(func(id NetworkID) {
            ret.handleDisappearedPeer(id)
        })
        api.RegisterTimeTickHandler(func(ts NetworkTime) {
            ret.handleTimeTick(ts)
        })

        return ret
    }


    // SetState updates this peer user data
    SetState(p: PeerUserState) {
        this.meshNetworkState[this.api.GetMyID()] = new peerState(p, this.currentTS)
        this.sendDbgData()

        let serialisedState = this.meshNetworkState

        for (let key in this.syncers) {
            let syncer = this.syncers[key]
            syncer.updateData(serialisedState)
        }
    }

}
