const EventEmitter = require('events');

// Creamos una clase que hereda de EventEmitter para poder instanciarla
class MyEmitter extends EventEmitter {}

// Exportamos una ÚNICA instancia (patrón Singleton) para que toda la aplicación
// comparta el mismo emisor de eventos.
const emitter = new MyEmitter();

module.exports = emitter;