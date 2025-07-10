// tiktokUtils.js
const createApiRequestOptions = () => ({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive"
  }
});

/**
 * Procesa la respuesta de la API de stickers y extrae las URLs.
 * @param {object} stickerApiResponse - El objeto de respuesta de la API de stickers.
 * @returns {Array<{emote_id: string, img: string}>} Un array de objetos de stickers.
 */
function parseStickerData(stickerApiResponse) {
  const stickersArray = [];
  if (!stickerApiResponse || !stickerApiResponse.data) return stickersArray;

  const data = stickerApiResponse.data;

  // Fuentes de stickers y cómo procesarlas
  const stickerSources = [
    { path: 'data.current_emote_detail.emote_list', type: 'standard' },
    { path: 'data.emote_config.default_emote_list', type: 'standard' },
    { path: 'data.stable_emote_detail.emote_list', type: 'standard' },
    { path: 'data.package_emote_list', type: 'package' }
  ];

  stickerSources.forEach(source => {
    try {
      const emoteList = getNestedProperty(data, source.path);
      if (!Array.isArray(emoteList)) return;

      if (source.type === 'standard') {
        emoteList.forEach(emote => {
          const url = emote.image?.url_list?.find(u => u.startsWith("https://p16"));
          if (url && !stickersArray.some(item => item.emote_id === emote.emote_id)) {
            stickersArray.push({ emote_id: emote.emote_id, img: url });
          }
        });
      } else if (source.type === 'package') {
        emoteList.forEach(pkg => {
          pkg.emote_detail?.emote_list?.forEach(emote => {
            const url = emote.image?.url_list?.find(u => u.startsWith("https://p16"));
            if (url && !stickersArray.some(item => item.emote_id === emote.emote_id)) {
              stickersArray.push({ emote_id: emote.emote_id, img: url });
            }
          });
        });
      }
    } catch (error) {
      // Ignorar errores si la ruta no existe
    }
  });

  return stickersArray;
}

/**
 * Accede de forma segura a una propiedad anidada en un objeto.
 * @param {object} obj - El objeto a consultar.
 * @param {string} path - La ruta a la propiedad (ej: 'user.details.name').
 * @returns {*} El valor de la propiedad o undefined si no se encuentra.
 */
function getNestedProperty(obj, path) {
  return path.split('.').reduce((prev, curr) => (prev?.[curr]), obj);
}

/**
 * Actualiza los parámetros de una URL.
 * @param {string} url - La URL a actualizar.
 * @param {object} params - Un objeto con los parámetros a añadir o modificar.
 * @returns {string} La URL actualizada.
 */
function updateUrlParams(url, params) {
  const [baseUrl, queryString] = url.split("?");
  const urlParams = new URLSearchParams(queryString || '');
  for (const key in params) {
    urlParams.set(key, params[key]);
  }
  return `${baseUrl}?${urlParams.toString()}`;
}

/**
 * Transforma un objeto de usuario de TikTok a un formato más simple y útil.
 * @param {object} user - El objeto de usuario original.
 * @returns {object} El objeto de usuario parseado.
 */
function parseUser(user) {
    if (!user) return null;

    const parsedUser = {
        userId: user.userId?.toString(),
        uniqueId: user.uniqueId || undefined,
        nickname: user.nickname || undefined,
        profilePictureUrl: getProfilePictureUrl(user.profilePicture?.urls),
        followRole: user.followInfo?.followStatus,
        userBadges: parseUserBadges(user.badge), // Corregido de 'badges' a 'badge' según esquemas comunes
        userDetails: {
            createTime: user.createTime?.toString(),
            bioDescription: user.bioDescription,
        },
        followInfo: user.followInfo
    };

    // Propiedades calculadas para facilitar el uso
    parsedUser.isModerator = parsedUser.userBadges.some(b => b.type?.toLowerCase().includes("moderator"));
    parsedUser.isSubscriber = parsedUser.userBadges.some(b => b.type?.toLowerCase().includes("subscriber"));
    
    const gifterBadge = parsedUser.userBadges.find(b => b.type === 'privilege' && b.privilegeId === '7001');
    parsedUser.gifterLevel = gifterBadge ? gifterBadge.level : 0;
    
    return parsedUser;
}

/**
 * Elige la mejor URL de imagen de perfil de una lista.
 * @param {string[]} pictureUrls - Array de URLs de imagen.
 * @returns {string|null} La URL de la imagen de perfil o null.
 */
function getProfilePictureUrl(pictureUrls) {
    if (!Array.isArray(pictureUrls) || pictureUrls.length === 0) return null;
    return pictureUrls[0] || null; // Simplificado para devolver la primera, que suele ser la principal.
}

/**
 * Procesa las insignias (badges) de un usuario a un formato simplificado.
 * @param {Array} badges - El array de insignias del objeto de usuario.
 * @returns {Array} Un array de insignias simplificadas.
 */
function parseUserBadges(badges) {
    if (!Array.isArray(badges)) return [];

    const simplifiedBadges = [];
    badges.forEach(badgeContainer => {
        if (badgeContainer?.privilegeLogExtra?.level && badgeContainer.privilegeLogExtra.level !== '0') {
            simplifiedBadges.push({
                type: 'privilege',
                privilegeId: badgeContainer.privilegeLogExtra.privilegeId,
                level: parseInt(badgeContainer.privilegeLogExtra.level, 10),
            });
        }
        if (badgeContainer?.displayType?.toLowerCase().includes('moderator')) {
            simplifiedBadges.push({ type: 'moderator' });
        }
        if (badgeContainer?.displayType?.toLowerCase().includes('subscriber')) {
            simplifiedBadges.push({ type: 'subscriber' });
        }
    });

    return simplifiedBadges;
}

/**
 * Decodifica y transforma la carga útil principal de un mensaje de webcast.
 * @param {object} data - Los datos decodificados de Protobuf.
 * @returns {object} Los datos procesados y listos para emitir.
 */
function handleMessageDecoding(data) {
  const processedData = { ...data };

  if (processedData.user) {
    Object.assign(processedData, parseUser(processedData.user));
    delete processedData.user;
  }

  if (processedData.giftId) {
    processedData.gift = {
      gift_id: processedData.giftId,
      repeat_count: processedData.repeatCount,
      repeat_end: !!processedData.repeatEnd,
      ...processedData.giftDetails,
    };
    delete processedData.giftDetails;
    delete processedData.giftId;
    delete processedData.repeatCount;
    delete processedData.repeatEnd;
  }
  
  if (processedData.emote) {
    processedData.emoteId = processedData.emote?.emoteId;
    processedData.emoteImageUrl = processedData.emote?.image?.imageUrl;
    delete processedData.emote;
  }

  // Añadir más transformaciones si es necesario...

  return processedData;
}


// Exportar todas las funciones para que puedan ser usadas en otros archivos.
module.exports = {
  parseStickerData,
  getNestedProperty,
  updateUrlParams,
  parseUser,
  getProfilePictureUrl,
  parseUserBadges,
  handleMessageDecoding,
  createApiRequestOptions 
};