import gb from "./gb.svg";
import es from "./es.svg";
import fr from "./fr.svg";
import de from "./de.svg";
import sa from "./sa.svg";
import kr from "./kr.svg";
import ru from "./ru.svg";
import jp from "./jp.svg";
import cn from "./cn.svg";
import inFlag from "./in.svg";
import pt from "./pt.svg";
import il from "./il.svg";
import gr from "./gr.svg";

// Bundled flag SVGs for the rotating tagline's hover tooltip, keyed by
// ISO-3166 country code. Sourced once from flagcdn.com and checked in —
// the running app never hot-links flagcdn.
export const FLAG_ICONS: Record<string, string> = {
  gb, es, fr, de, sa, kr, ru, jp, cn, in: inFlag, pt, il, gr,
};
