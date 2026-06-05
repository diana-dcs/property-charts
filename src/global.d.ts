import type * as Moment from "moment";

declare global {
  interface Window {
    moment: typeof Moment;
  }
}
