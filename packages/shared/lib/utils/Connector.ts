import { HttpRequest } from './Request'

// 连接器,用于爬取不同的数据源
export class Connector {
    constructor(connector: 'yu_que') {
        switch (connector) {
            case 'yu_que':
                return new YUQUE()
            default:
                return new YUQUE()
        }
    }

}


// 语雀连接器
class YUQUE {
    private request: HttpRequest
    constructor() {
        this.request = new HttpRequest({
            baseURL: 'https://www.yuque.com/api/v2',
            headers: {
                'X-Auth-Token': ''
            }
        })

    }
    async fetchData(): Promise<any> {


    }
}

