import React, { createContext, useContext, useState } from 'react';

interface GlobalContextValue {
    // resource的数据
    connectionList: DB.ConnectionDocUnion[];
    setConnectionList: React.Dispatch<React.SetStateAction<DB.ConnectionDocUnion[]>>;
}

const defaultContextValue: GlobalContextValue = {
    connectionList: [],
    setConnectionList: () => { },
};

const GlobalContext = createContext(defaultContextValue);

export const GlobalProvider = ({ children }) => {
    const [connectionList, setConnectionList] = useState<DB.ConnectionDocUnion[]>([]);


    return (
        <GlobalContext.Provider value={{ connectionList, setConnectionList }}>
            {children}
        </GlobalContext.Provider>
    );
};

// 创建一个自定义的 hook 来便于在其他组件中使用 Context 数据
export const useGlobalContext = () => {
    return useContext(GlobalContext);
};
