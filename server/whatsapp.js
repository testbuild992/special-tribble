const cfg = () => ({
  token: process.env.WHATSAPP_TOKEN,
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  template: process.env.WHATSAPP_TEMPLATE_NAME || 'otp_message',
});

export function whatsappConfigured() {
  const c = cfg();
  return Boolean(c.token && c.phoneId);
}

export async function sendWhatsAppMessage(to, body) {
  if (!whatsappConfigured()) {
    return { ok: true, dev: true };
  }
  const { token, phoneId } = cfg();
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'WhatsApp API error');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendWhatsAppTemplate(to, templateName, components) {
  if (!whatsappConfigured()) {
    return { ok: true, dev: true };
  }
  const { token, phoneId } = cfg();
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          ...(components ? { components } : {}),
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'WhatsApp API error');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendOtp(to, code) {
  if (!whatsappConfigured()) {
    console.log(`[DEV OTP] WhatsApp +${to} -> ${code}`);
    return { ok: true, dev: true, devOtp: code };
  }
  const body = `Your BIJI verification code is ${code}. It expires in 5 minutes. - BIJI by Chef Brown`;
  return sendWhatsAppMessage(to, body);
}
