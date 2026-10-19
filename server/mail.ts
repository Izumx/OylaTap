import nodemailer from 'nodemailer';
export type ResetMessage = { to: string; url: string; language: 'ru' | 'kk' };
export type ResetSender = { send(message: ResetMessage): Promise<void> };
// Only a configured trusted origin can appear in reset emails; never use request Host.
export function trustedAppUrl(value = process.env.APP_URL): string | undefined {
  try {
    if (!value) return;
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return;
    if (
      url.protocol !== 'https:' &&
      !(local && url.protocol === 'http:' && process.env.NODE_ENV !== 'production')
    )
      return;
    return url.origin;
  } catch {
    return;
  }
}
export function smtpResetSender(env: NodeJS.ProcessEnv = process.env): ResetSender | undefined {
  const port = Number(env.SMTP_PORT || 587);
  if (
    env.PASSWORD_RECOVERY_ENABLED !== 'true' ||
    !env.SMTP_HOST ||
    !env.SMTP_FROM ||
    !env.SMTP_USER ||
    !env.SMTP_PASSWORD ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send({ to, url, language }) {
      const kk = language === 'kk';
      const result = await transport.sendMail({
        from: env.SMTP_FROM,
        to,
        subject: kk ? 'OylaTap: құпиясөзді қалпына келтіру' : 'OylaTap: восстановление пароля',
        text: kk
          ? `Құпиясөзді өзгерту үшін сілтемені ашыңыз (30 минут жарамды):\n${url}\n\nСұрауды сіз жібермесеңіз, хатты елемеңіз. Құпиясөз өзгермейді.`
          : `Чтобы изменить пароль, откройте ссылку (действует 30 минут):\n${url}\n\nЕсли вы не запрашивали смену пароля, проигнорируйте письмо. Пароль останется прежним.`,
      });
      if (!result.accepted?.length) throw new Error('Reset email was not accepted');
    },
  };
}
