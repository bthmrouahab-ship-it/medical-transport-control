/** صوت تنبيه قصير بلا ملف صوتي (المتصفح يسمح به بعد أول ضغطة من المستخدم في الصفحة). */
export function beep(times = 2) {
  try {
    const context = new AudioContext();
    for (let index = 0; index < times; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.15;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.35);
      oscillator.stop(context.currentTime + index * 0.35 + 0.2);
    }
    window.setTimeout(() => context.close().catch(() => undefined), times * 400 + 200);
  } catch {
    /* المتصفح لا يدعم الصوت هنا */
  }
}
