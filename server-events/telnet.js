// @ts-check
'use strict';

const Telnet = require('ranvier-telnet');
const { Logger, TransportStream } = require('ranvier');

class TelnetStream extends TransportStream {
  constructor(telnetSocket) {
    super();
    this.telnetSocket = telnetSocket;
  }

  attach(rawSocket) {
    this.telnetSocket.attach(rawSocket);
    this.telnetSocket.on('data', data => this.emit('data', data));
    this.telnetSocket.on('close', () => this.emit('close'));
    this.telnetSocket.on('error', err => this.emit('error', err));
  }

  write(data, encoding) {
    this.telnetSocket.write(data, encoding);
  }

  end(data, encoding) {
    this.telnetSocket.end(data, encoding);
  }

  get readable() {
    return this.telnetSocket.readable;
  }

  get writable() {
    return this.telnetSocket.writable;
  }

  executeGoAhead() {
    const mode = this.telnetSocket.gaMode;
    if (mode === Telnet.Sequences.EOR) {
      this.telnetSocket.socket.write(Buffer.from([Telnet.Sequences.IAC, Telnet.Sequences.EOR]));
    } else {
      this.telnetSocket.socket.write(Buffer.from([Telnet.Sequences.IAC, Telnet.Sequences.GA]));
    }
  }

  executeToggleEcho() {
    this.telnetSocket.toggleEcho();
  }
}

module.exports = {
  listeners: {
    startup: state => (commander) => {
      const port = Number.parseInt(commander.port, 10) || state.Config.get('port', 4000);
      const inputEvents = state.InputEventManager.get('main');

      const server = new Telnet.TelnetServer(rawSocket => {
        const telnetSocket = new Telnet.TelnetSocket();
        const stream = new TelnetStream(telnetSocket);
        stream.attach(rawSocket);

        const session = {
          state: 'getName',
          socket: stream,
          username: null,
          account: null,
          player: null,
          isNewAccount: false,
          processing: false,
        };

        stream.on('data', async (data) => {
          if (!inputEvents || inputEvents.size === 0) {
            return;
          }

          for (const listener of inputEvents) {
            try {
              await listener(session, data);
            } catch (err) {
              /** @type {{ stack?: string, message?: string }} */
              const listenerError = err;
              Logger.error(listenerError.stack || listenerError.message || 'Unknown listener error');
            }
          }
        });

        stream.on('close', async () => {
          /** @type {InstanceType<import('ranvier').Player> | null} */
          const player = session.player;
          if (!player || player.__pruned) {
            return;
          }

          try {
            await state.PlayerManager.save(player);
          } catch (err) {
            /** @type {{ message?: string }} */
            const saveError = err;
            Logger.warn(saveError.message || 'Unknown save error');
          }

          state.PlayerManager.removePlayer(player, false);
        });

        stream.on('error', err => {
          /** @type {{ stack?: string, message?: string }} */
          const socketError = err;
          Logger.error(socketError.stack || socketError.message || 'Unknown socket error');
        });

        stream.write('Welcome, what is your name? ');
      });

      server.netServer.listen(port, () => {
        Logger.log(`Telnet server started on port: ${port}`);
      });

      state.TelnetServer = server;
    },

    shutdown: state => () => {
      if (state.TelnetServer && state.TelnetServer.netServer) {
        state.TelnetServer.netServer.close();
      }
    }
  }
};
