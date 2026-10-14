export const KAOMOJI: readonly string[] = [
  "(╯°□°)╯︵ ┻━┻",
  "¯\\_(ツ)_/¯",
  "(；￣Д￣)",
  "(´・ω・`)",
  "(T_T)",
  "(ಥ﹏ಥ)",
  "(>_<)",
  "(︶︹︶)",
  "(._.)",
  "(⊙_⊙)?",
  "(´；ω；`)",
  "(ーー;)",
  "orz",
  "щ(ºДºщ)",
  "(・_・ヾ",
  "(×_×)",
];

export const randomKaomoji = () => KAOMOJI[Math.floor(Math.random() * KAOMOJI.length)];
