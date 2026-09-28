export const SUPPORT_TEAM_NAME = 'Cenar Care';
export const SUPPORT_TEAM_PREFIX = '**[Cenar Care • Website]**';
export const CUSTOMER_WEB_PREFIX = '**[Khách từ Web]**';

export function isSupportStaffRole(role) {
  return role === 'admin' || role === 'staff';
}

export function websiteRelayPrefix(role) {
  return isSupportStaffRole(role) ? SUPPORT_TEAM_PREFIX : CUSTOMER_WEB_PREFIX;
}

export function parseWebsiteRelay(content) {
  const value = String(content || '');
  const customerMatch = value.match(/^\*\*\[Khách\s*(?:hàng\s*)?từ\s*Web\]\*\*:\s*/i);
  if (customerMatch) {
    return {
      authorType: 'customer',
      authorName: 'Khách hàng',
      content: value.slice(customerMatch[0].length).trim(),
    };
  }

  const careMatch = value.match(/^\*\*\[Cenar\s+Care(?:\s*[•·-]\s*Website|\s+từ\s+Web)?\]\*\*:\s*/i);
  if (careMatch) {
    return {
      authorType: 'staff',
      authorName: SUPPORT_TEAM_NAME,
      content: value.slice(careMatch[0].length).trim(),
    };
  }

  const legacyStaffMatch = value.match(/^\*\*\[Staff\s+(.*?)\s+từ\s+Web\]\*\*:\s*/i);
  if (legacyStaffMatch) {
    return {
      authorType: 'staff',
      authorName: legacyStaffMatch[1] || 'Staff',
      content: value.slice(legacyStaffMatch[0].length).trim(),
    };
  }

  const legacyAdminMatch = value.match(/^\*\*\[Admin\s+từ\s+Web\]\*\*:\s*/i);
  if (legacyAdminMatch) {
    return {
      authorType: 'staff',
      authorName: 'Admin',
      content: value.slice(legacyAdminMatch[0].length).trim(),
    };
  }

  return null;
}

export function presentSupportMessage(message, audienceRole) {
  if (message?.authorType !== 'staff' || isSupportStaffRole(audienceRole)) return message;
  return {
    ...message,
    authorName: SUPPORT_TEAM_NAME,
    authorAvatar: null,
  };
}

export function presentArchivedSupportMessages(messages, { customerId, audienceRole } = {}) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message, index) => {
    const author = message?.author || {};
    let authorType = 'staff';
    let authorName = author.displayName || author.username || 'Staff';
    let authorAvatar = author.avatarUrl || null;
    let content = String(message?.content || '');

    if (author.bot) {
      const relay = parseWebsiteRelay(content);
      if (relay) {
        ({ authorType, authorName, content } = relay);
      } else {
        authorType = 'system';
        authorName = 'Hệ thống';
        authorAvatar = null;
      }
    } else if (String(author.id || '') === String(customerId || '')) {
      authorType = 'customer';
      authorName = author.displayName || author.username || 'Khách hàng';
    }

    if (!content && Array.isArray(message?.embeds) && message.embeds.length > 0) {
      content = String(message.embeds[0]?.description || message.embeds[0]?.title || '');
      authorType = 'system';
      authorName = 'Hệ thống';
      authorAvatar = null;
    }

    const attachmentNames = Array.isArray(message?.attachments)
      ? message.attachments.map((attachment) => String(attachment?.name || '').trim()).filter(Boolean)
      : [];
    if (attachmentNames.length > 0) {
      content = [content, `Tệp đính kèm: ${attachmentNames.join(', ')}`].filter(Boolean).join('\n');
    }

    return presentSupportMessage({
      id: message?.id || `archive-${index}`,
      authorType,
      authorName,
      authorAvatar,
      content: content.trim(),
      timestamp: message?.createdAt || null,
    }, audienceRole);
  }).filter((message) => message.content);
}
