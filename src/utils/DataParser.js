// src/utils/DataParser.js

/**
 * Procesa y decodifica los datos de los mensajes de TikTok.
 * Normaliza la estructura de datos para un uso más sencillo.
 * @param {Object} data - El objeto de datos decodificado de Protobuf.
 * @returns {Object} - Un nuevo objeto con la data procesada.
 */
function handleMessageDecoding(data) {
    if (data.user) {
        Object.assign(data, parseUser(data.user));
        delete data.user;
    }

    if (data.giftId) {
        data.repeatEnd = !!data.repeatEnd; // Convert to boolean
        data.gift = {
            gift_id: data.giftId,
            repeat_count: data.repeatCount,
            repeat_end: data.repeatEnd,
            gift_type: data.giftDetails?.giftType,
        };

        if (data.giftDetails) {
            Object.assign(data, data.giftDetails);
            delete data.giftDetails;
        }
    }
    
    // Aquí se pueden añadir más transformaciones según sea necesario.
    // El objetivo es aplanar y simplificar la estructura del evento.
    
    return Object.assign({}, data);
}


function getProfilePictureUrl(pictureUrls) {
    if (!pictureUrls || !Array.isArray(pictureUrls) || pictureUrls.length === 0) {
        return null;
    }
    return (
        pictureUrls.find(url => typeof url === 'string' && url.includes('100x100')) ||
        pictureUrls.find(url => typeof url === 'string' && !url.includes('shrink')) ||
        (typeof pictureUrls[0] === 'string' ? pictureUrls[0] : null)
    );
}

function parseUserBadges(badges) {
    const simplifiedBadges = [];
    if (!Array.isArray(badges)) return simplifiedBadges;

    badges.forEach(badgeGroup => {
        if (badgeGroup?.privilegeLogExtra?.level && badgeGroup.privilegeLogExtra.level !== '0') {
            simplifiedBadges.push({
                type: 'privilege',
                badgeSceneType: badgeGroup.badgeSceneType,
                privilegeId: badgeGroup.privilegeLogExtra.privilegeId,
                level: parseInt(badgeGroup.privilegeLogExtra.level, 10),
            });
        }
        if (Array.isArray(badgeGroup?.imageBadges)) {
            badgeGroup.imageBadges.forEach(badge => {
                if (badge?.image?.url) {
                    simplifiedBadges.push({
                        type: 'image',
                        badgeSceneType: badgeGroup.badgeSceneType,
                        url: badge.image.url,
                    });
                }
            });
        }
    });

    return simplifiedBadges;
}

function parseUser(user) {
    const parsedUser = {
        userId: user.userId?.toString(),
        uniqueId: user.uniqueId || undefined,
        nickname: user.nickname || undefined,
        profilePictureUrl: getProfilePictureUrl(user.profilePicture?.urls),
        followRole: user.followInfo?.followStatus,
        userBadges: parseUserBadges(user.badges),
        bioDescription: user.bioDescription
    };

    parsedUser.isModerator = parsedUser.userBadges.some(b => b.badgeSceneType === 1);
    parsedUser.isSubscriber = parsedUser.userBadges.some(b => b.badgeSceneType === 4 || b.badgeSceneType === 7);
    
    const gifterBadge = parsedUser.userBadges.find(b => b.badgeSceneType === 8);
    parsedUser.gifterLevel = gifterBadge ? gifterBadge.level : 0;
    
    return parsedUser;
}

module.exports = {
    handleMessageDecoding,
    parseUser
};