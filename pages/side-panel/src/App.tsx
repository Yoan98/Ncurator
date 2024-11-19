import { Button, ConfigProvider, ConfigProviderProps, Dropdown, MenuProps, Drawer } from 'antd';
import React, { useState, useLayoutEffect, useEffect } from 'react';
import { GlobalProvider } from '@src/provider/global';
import * as constant from '@src/utils/constant';
import SidePanel from '@src/SidePanel';

import dayjs from 'dayjs';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/lib/locale/en_US';
import 'dayjs/locale/zh-cn';


type Locale = ConfigProviderProps['locale'];
dayjs.locale('en');


const App = () => {
    const [locale, setLocal] = useState<Locale>(enUS);

    const initLang = () => {
        const curLang = navigator.language || 'en';
        if (curLang.startsWith('zh')) {
            setLocal(zhCN);
            dayjs.locale('zh-cn');
        }
    }

    useLayoutEffect(() => {
        initLang();
    }, []);

    return (
        <ConfigProvider
            locale={locale}
            theme={{
                token: {
                    colorPrimary: constant.THEME_COLOR,
                },
                components: {
                    Progress: {
                        defaultColor: constant.THEME_COLOR
                    }
                }
            }}
        >
            <GlobalProvider>
                <SidePanel />
            </GlobalProvider>
        </ConfigProvider>
    )
}

export default App;