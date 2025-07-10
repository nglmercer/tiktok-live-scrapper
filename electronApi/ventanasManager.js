// managerVentanas.js

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

/**
 * Clase para gestionar la creación y ciclo de vida de las ventanas de la aplicación.
 */
class VentanasManager {
  constructor(devTools = false) {
    // --- Propiedades de configuración ---
    this.devTools = devTools;
    this.icono = path.join(__dirname, './icon.png');
    this.preloadScript = path.join(__dirname, './preloadIndex.js');

    // --- Estado de la aplicación ---
    this.ventanasActivas = [];
    this.cerrandoTodo = false; // Flag para evitar bucles o errores al cerrar todo
  }

  /**
   * Crea una nueva ventana de BrowserWindow a partir de un objeto de configuración.
   * Este es el método central para toda la creación de ventanas.
   * @param {object} config - Objeto de configuración para la nueva ventana.
   * @returns {BrowserWindow} La instancia de la ventana creada.
   */
  crearNueva(config = {}) {
    // --- Configuración por defecto ---
    const defaultConfig = {
      show: true,
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      frame: true,
      autoHideMenuBar: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: true, // Considerar cambiar a false por seguridad si es posible
        contextIsolation: true,
        preload: this.preloadScript,
        devTools: this.devTools,
      },
    };

    // Unimos la configuración del usuario con la de por defecto
    const finalConfig = { ...defaultConfig, ...config };
    // Aseguramos que las webPreferences anidadas también se unan correctamente
    finalConfig.webPreferences = { ...defaultConfig.webPreferences, ...config.webPreferences };

    const ventana = new BrowserWindow(finalConfig);
    ventana.setIcon(this.icono);

    // --- Carga de contenido ---
    if (finalConfig.url) {
      ventana.loadURL(finalConfig.url);
    } else if (finalConfig.file) {
      ventana.loadFile(path.join(__dirname, finalConfig.file));
    }

    // --- Configuración de Eventos y Comportamiento ---
    this._configurarAtajos(ventana);
    this._configurarEventos(ventana, finalConfig);
    
    // Si se especificó una lógica especial (como para el navegador de TikTok)
    if (finalConfig.specialLogic) {
        ventana.webContents.on('did-finish-load', () => {
            // Enviamos los datos necesarios al script de preload de forma segura
            ventana.webContents.send('ejecutar-logica-especial', { 
                tipo: finalConfig.specialLogic,
                url2: finalConfig.url2 || "" // pasamos url2 si existe
            });
        });
    }

    // Guardar referencia si no es la ventana principal que cierra todo
    if (!finalConfig.closeAlCerrar) {
      this.ventanasActivas.push(ventana);
    }

    return ventana;
  }

  /**
   * Configura los eventos de la ventana (cierre, mostrar, etc.).
   * @private
   */
  _configurarEventos(ventana, config) {
    // Mostrar la ventana cuando esté lista (si no es una URL, que puede tardar en cargar)
    ventana.on('ready-to-show', () => {
      if (!config.url) {
        ventana.show();
      }
    });

    if (config.siempreTop) {
      ventana.setAlwaysOnTop(true, 'screen');
    }

    // Comportamiento al cerrar la ventana
    if (config.closeAlCerrar) {
      ventana.on('closed', () => {
        this.cerrandoTodo = true;
        this.ventanasActivas.forEach(v => {
          if (!v.isDestroyed()) {
            v.close();
          }
        });
        app.quit();
      });
    } else {
        // Para ventanas que solo se ocultan al cerrar (como las transparentes)
        if (config.ocultarAlCerrar) {
            ventana.on('close', (event) => {
                if (!this.cerrandoTodo) {
                    event.preventDefault();
                    ventana.hide();
                }
            });
        }
    }
  }

  /**
   * Deshabilita los atajos de teclado de desarrollo si devTools está desactivado.
   * @private
   */
  _configurarAtajos(ventana) {
    if (this.devTools) {
      ventana.webContents.openDevTools();
    } else {
      // Deshabilitar atajos para evitar que el usuario abra devtools o recargue
      ventana.webContents.on('before-input-event', (event, input) => {
        const isCtrlR = input.control && !input.shift && input.key.toLowerCase() === 'r';
        const isCtrlShiftR = input.control && input.shift && input.key.toLowerCase() === 'r';
        const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i';
        const isAlt = input.alt;

        if (isCtrlR || isCtrlShiftR || isCtrlShiftI || isAlt) {
          event.preventDefault();
        }
      });
    }
  }

  // ======================================================================
  // MÉTODOS ESPECIALIZADOS PARA CREAR VENTANAS
  // Ahora son mucho más legibles y solo definen la configuración.
  // ======================================================================

  crearNavegador(url, noCerrar) {
    console.log('Creando ventana navegador hidden para:', url);
    return this.crearNueva({
      show: false, // Inician ocultas
      width: 620,
      height: 865,
      minWidth: 620,
      minHeight: 865,
      url: url,
      ocultarAlCerrar: noCerrar, // El parámetro `noCerrar` decide si se oculta o se cierra
      specialLogic: 'tiktokLogin' // Identificador para la lógica en preload
    });
  }

  crearNavegador2(url1, url2) {
    console.log('Creando ventana navegador hidden 2 para:', url1, url2);
    return this.crearNueva({
      show: false,
      width: 620,
      height: 865,
      minWidth: 620,
      minHeight: 865,
      url: url1,
      url2: url2, // Pasamos url2 para que la lógica de preload la use
      specialLogic: 'tiktokFetch' // Otro identificador
    });
  }
  
  crearPrincipal(filePath) {
    return this.crearNueva({
      file: filePath,
      width: screen.getPrimaryDisplay().workAreaSize.width,
      height: screen.getPrimaryDisplay().workAreaSize.height,
      minWidth: 620,
      minHeight: 865,
      x: 0, y: 0,
      autoHideMenuBar: true,
      closeAlCerrar: true, // Esta es la ventana principal
    });
  }

  crearLogin(filePath) {
    return this.crearNueva({
      file: filePath,
      width: 800,
      height: 450,
      minWidth: 800,
      minHeight: 450,
      autoHideMenuBar: true,
      frame: true,
    });
  }
  
  crearReconexion(filePath) {
    const [width, height] = [400, 100];
    const { workArea } = screen.getPrimaryDisplay();
    return this.crearNueva({
      file: filePath,
      width, height,
      minWidth: width, minHeight: height,
      x: workArea.width - width - 10,
      y: workArea.height - height - 10,
      autoHideMenuBar: true,
      frame: false,
      siempreTop: true,
    });
  }
  
  crearPublicidad(filePath) {
    return this.crearNueva({
        file: filePath,
        width: 600, height: 250,
        frame: false,
        siempreTop: true,
        transparent: true,
        ocultarAlCerrar: true,
    });
  }

  // ... Puedes seguir el mismo patrón para el resto de métodos ...
  // crearHistorial, crearTimer, crearRanking, etc.
  
  crearUpdater(filePath) {
    return this.crearNueva({
        file: filePath,
        width: 400, height: 400,
        minWidth: 400, minHeight: 400,
        autoHideMenuBar: true,
        frame: false,
        closeAlCerrar: true,
    });
  }
}

module.exports = VentanasManager;