import Foundation
import Network

@available(macOS 12, *)
extension DeviceRuntime {
  func reconnect() {
    guard foreground, !restoring, !revoking, trust?.quarantined != true, active == nil,
      let service = trust?.route.pair ?? pairing?.offer.service ?? scanned?.service
    else { return }
    if monitor == nil {
      let watch = NWPathMonitor()
      monitor = watch
      watch.pathUpdateHandler = { [weak watch] path in
        guard let watch, self.monitor === watch else { return }
        if path.status == .satisfied {
          self.reconnect()
        } else if path.unsatisfiedReason == .localNetworkDenied {
          self.denied()
        }
      }
      watch.start(queue: queue)
    }
    do {
      let identity = try localIdentity()
      let params: NWParameters
      if let expected = trust?.pin ?? scanned?.serverPin {
        params = try TrustedTransport.parameters(
          identity: identity, peerPin: expected, queue: queue)
      } else {
        params = try TrustedTransport.pairingListener(identity: identity, queue: queue)
      }
      if isMac {
        guard listener == nil else { return }
        let host = try NWListener(using: params)
        listener = host
        advertisedPin = trust?.pin
        host.service = .init(
          name: service.uuidString, type: TrustedTransport.serviceType, domain: "local.")
        host.newConnectionHandler = { [weak host] incoming in
          guard let host, self.listener === host, self.active == nil else {
            incoming.cancel()
            return
          }
          self.connect(incoming)
        }
        host.stateUpdateHandler = { [weak host] state in
          guard let host, self.listener === host else { return }
          switch state {
          case .ready: self.available()
          case .waiting(let error): if self.isDenied(error) { self.denied() }
          case .failed(let error):
            if self.isDenied(error) { self.denied() }
            host.cancel()
            self.listener = nil
            self.retry()
          default: break
          }
        }
        host.start(queue: queue)
      } else {
        guard browser == nil else { return }
        let query = NWParameters.tcp
        query.includePeerToPeer = false
        query.prohibitedInterfaceTypes = [.cellular, .other]
        let search = NWBrowser(
          for: .bonjour(type: TrustedTransport.serviceType, domain: "local."), using: query)
        browser = search
        search.browseResultsChangedHandler = { [weak search] results, _ in
          guard let search, self.browser === search, self.active == nil else { return }
          for result in results {
            if case .service(let name, _, _, _) = result.endpoint, name == service.uuidString {
              self.connect(NWConnection(to: result.endpoint, using: params))
              break
            }
          }
        }
        search.stateUpdateHandler = { [weak search] state in
          guard let search, self.browser === search else { return }
          switch state {
          case .ready: self.available()
          case .waiting(let error): if self.isDenied(error) { self.denied() }
          case .failed(let error):
            if self.isDenied(error) { self.denied() }
            search.cancel()
            self.browser = nil
            self.retry()
          default: break
          }
        }
        search.start(queue: queue)
      }
    } catch { setFailure(error) }
  }

  private func isDenied(_ error: NWError) -> Bool {
    // kDNSServiceErr_PolicyDenied. A timeout on an isolated Wi-Fi is not
    // evidence of denied permission.
    if case .dns(let code) = error { return code == -65570 }
    return false
  }

  private func denied() {
    state = "permission"
    issue = "localNetwork"
  }

  private func available() {
    if issue == "localNetwork" {
      issue = nil
      state = pairing != nil ? "offering" : scanned != nil ? "scanning" : "waiting"
    }
  }

  private func retry() {
    let token = attempt
    queue.asyncAfter(deadline: .now() + .seconds(reconnectDelay)) {
      if self.attempt == token { self.reconnect() }
    }
    reconnectDelay = min(20, reconnectDelay * 2)
  }

  private func connect(_ connection: NWConnection) {
    active = connection
    let currentTrust = trust
    let offer = pairing?.offer ?? scanned
    connection.stateUpdateHandler = { [weak connection] state in
      guard let connection, self.active === connection else { return }
      switch state {
      case .ready:
        self.worker.async {
          var failure: Error?
          do {
            let link = LinkChannel(connection)
            let remotePin = try TrustedTransport.authenticatedPin(connection)
            if let peer = currentTrust {
              guard remotePin == peer.pin else { throw DeviceLinkError.identity }
              try self.sync(link, peer: peer)
            } else if let offer {
              try self.pair(link, offer: offer, pin: remotePin)
            }
          } catch { failure = error }
          self.queue.async { self.finished(connection, error: failure) }
        }
      case .waiting(let error):
        if self.isDenied(error) || connection.currentPath?.unsatisfiedReason == .localNetworkDenied
        {
          self.denied()
          self.finished(connection, error: DeviceLinkError.disconnected)
        }
      // Network.framework may enter waiting briefly while resolving paths.
      // The per-attempt deadline below still bounds discovery and TLS.
      case .failed: self.finished(connection, error: DeviceLinkError.disconnected)
      default: break
      }
    }
    connection.viabilityUpdateHandler = { [weak connection] viable in
      guard let connection, !viable, self.active === connection else { return }
      self.finished(connection, error: DeviceLinkError.disconnected)
    }
    connection.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 15) {
      guard self.active === connection else { return }
      switch connection.state {
      case .ready: break
      default: self.finished(connection, error: DeviceLinkError.timeout)
      }
    }
  }

  private func finished(_ connection: NWConnection, error: Error?) {
    guard active === connection else { return }
    active = nil
    connection.cancel()
    // Recreate the browser to receive a fresh result even if Bonjour's result
    // set stayed unchanged throughout a TCP disconnect or failed TLS handshake.
    // Keep the verified listener/port advertised across normal phone restarts.
    // Only the transition from the temporary pairing policy to pinned trust
    // needs a new listener. Revocation and suspend stop it separately.
    if advertisedPin != trust?.pin {
      listener?.cancel()
      listener = nil
    }
    browser?.cancel()
    browser = nil
    if trust == nil, candidate != nil || pairing?.canBeClaimed == false {
      resetPairing()
      state = "error"
      issue = "connection"
      return
    }
    if trust != nil, state != "permission" {
      if let error {
        switch error {
        case DeviceLinkError.incompatible, DeviceLinkError.engine, DeviceLinkError.keychain,
          DeviceLinkError.reconcile:
          setFailure(error)
        default:
          state = "waiting"
          issue = nil
        }
      } else {
        state = "waiting"
        issue = nil
      }
    }
    retry()
  }
}
