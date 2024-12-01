import { Button, ConfigProvider, ConfigProviderProps, Dropdown, MenuProps, Drawer } from 'antd';
import React, { useState, useLayoutEffect, useEffect } from 'react';
import { GlobalProvider } from '@src/provider/global';
import * as config from '@src/config';
import SidePanel from '@src/SidePanel';
import { checkWebGPU } from '@src/utils/tool';
import { setDayjsLocale } from '@src/utils/dayjsGlobal';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/lib/locale/en_US';

import { EmbedTaskManage } from '@src/utils/EmbedTask';

type Locale = ConfigProviderProps['locale'];


const App = () => {
    const [antDLocale, setAntDLocal] = useState<Locale>(enUS);

    const initLang = () => {
        const curLang = navigator.language || 'en';
        if (curLang.startsWith('zh')) {
            setAntDLocal(zhCN);
            setDayjsLocale('zh-cn');
        }
    }

    useLayoutEffect(() => {
        initLang();

        checkWebGPU().then((isSupport) => {
            window.gIsSupportWebGPU = isSupport;
        });

        EmbedTaskManage.start()
    }, []);

    return (
        <ConfigProvider
            locale={antDLocale}
            theme={{
                token: {
                    colorPrimary: config.THEME_COLOR,
                },
                components: {
                    Progress: {
                        defaultColor: config.THEME_COLOR
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