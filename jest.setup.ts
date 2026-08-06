import moment from "moment";

(global as any).window = { ...(global as any).window, moment };
