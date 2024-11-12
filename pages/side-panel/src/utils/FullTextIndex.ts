import lunrZH from './resource/lunrZH'
import init, * as jieba from 'jieba-wasm';
import lunr from 'lunr';
import lunrSupport from 'lunr-languages/lunr.stemmer.support'
import lunrMulti from 'lunr-languages/lunr.multi.js'
lunrSupport(lunr)
lunrZH(lunr, jieba)
lunrMulti(lunr)

//@ts-ignore
const useMultiLanguageFn = lunr.multiLanguage('en', 'zh')
export class FullTextIndex {
    public lunrIndex: lunr.Index;

    constructor() {
    }

    async loadLunr() {
        //@ts-ignore
        await init()
    }

    loadSerializer(data) {
        this.lunrIndex = lunr.Index.load(data)
        return this.lunrIndex
    }

    add(fields: {
        field: string, attributes?: {
            boost?: number | undefined;
            extractor?: ((doc: object) => string | object | object[]) | undefined;
        }
    }[], data: Record<string, any>[]) {
        this.lunrIndex = lunr(function () {
            this.ref('id')
            this.use(useMultiLanguageFn);
            //@ts-ignore
            this.tokenizer = function (x) {
                //@ts-ignore
                return lunr.tokenizer(x).concat(lunr.zh.tokenizer(x));
            };

            fields.forEach((item) => {
                this.field(item.field, item.attributes || {})
            })

            data.forEach((item) => {
                this.add(item)
            }
            )
        })

        return this.lunrIndex
    }

    search(question: string) {
        if (!this.lunrIndex) {
            throw new Error('lunr index not initialized')
        }
        // 判断是否有中文
        const reg = new RegExp("[\\u4E00-\\u9FFF]+");
        if (reg.test(question)) {
            // 只要有一个中文，就代表是中文问题，需要分词
            const words = jieba.cut_for_search(question)

            question = words.join(' ')
        }

        return this.lunrIndex.search(question)
    }
}

export const fullTextIndex = new FullTextIndex();