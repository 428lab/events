declare module "japanese-holidays" {
  /** 祝日ならその名称、平日なら undefined（furikae=振替休日を含む、既定 true） */
  export function isHoliday(date: Date, furikae?: boolean): string | undefined;
  export function getHolidaysOf(
    year: number,
    furikae?: boolean,
  ): { month: number; date: number; name: string }[];
}
