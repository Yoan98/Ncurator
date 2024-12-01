import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('en');

// 只会改文案相关,不会影响不同时区的时间计算
export const setDayjsLocale = (locale: string) => {
    dayjs.locale(locale);
}

export default dayjs;