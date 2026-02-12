// @ts-check
'use strict';

function writeLine(session, message = '') {
  session.socket.write(message + '\r\n');
}

function prompt(session, message) {
  session.socket.write(message);
}

module.exports = {
  writeLine,
  prompt,
};
