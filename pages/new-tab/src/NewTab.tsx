import React, { useState, useLayoutEffect, useEffect } from 'react';
import {
    Tabs,
    Button,
    Typography,
    Row,
    Col,
    Space,
    Card,
    List,
    ConfigProvider,
    ConfigProviderProps,
    Image
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/lib/locale/en_US';
import {
    FaSearch,
    FaBolt,
    FaCloud
} from 'react-icons/fa';
import { CiCircleCheck, CiFileOn, CiDatabase, CiSearch } from "react-icons/ci";
import { AiOutlineInfoCircle } from "react-icons/ai";
import { t } from '@extension/i18n';
import { FiCheckCircle } from "react-icons/fi";

const { Title, Paragraph, Text } = Typography;
type Locale = ConfigProviderProps['locale'];

const BeCuratorLandingPage = () => {
    const [isWebGPUSupported, setIsWebGPUSupported] = useState(false);

    const tabContents = {
        what: (
            <Row gutter={[24, 24]} align="middle" justify="center">
                <Title level={2}>它是什么?</Title>
                <Paragraph className='px-[40px]'>
                    BeCurator 是一款注重数据安全的本地知识管理工具，支持本地采集各种数据（如文件、网页等），并通过本地存储和智能搜索功能进行高效管理。同时借助本地 AI 技术，结合您的问题和本地数据，BeCurator 能提供智能分析与精准回答，保障数据安全的同时，显著提升工作效率。
                </Paragraph>
                <Space direction="vertical">
                    {[
                        { icon: <CiFileOn size={30} />, text: '多源文件导入' },
                        { icon: <CiDatabase size={30} />, text: '本地数据存储' },
                        { icon: <CiSearch size={30} />, text: '智能语义搜索' }
                    ].map((item, index) => (
                        <Space key={index} align="center">
                            <Text style={{ fontSize: '1.5em', color: '#555' }}>{item.icon}</Text>
                            <Text>{item.text}</Text>
                        </Space>
                    ))}
                </Space>
            </Row>
        ),
        why: (
            <Row gutter={[24, 24]}>
                {[
                    {
                        icon: <FaBolt />,
                        title: '精准检索',
                        desc: '利用向量搜索技术，可精准定位您需要的信息'
                    },
                    {
                        icon: <FaCloud />,
                        title: '数据安全',
                        desc: '数据与AI计算只在您的电脑完成，不涉及外网，保护您的隐私和数据安全'
                    },
                    {
                        icon: <FaSearch />,
                        title: '智能分析',
                        desc: 'AI驱动的深度分析，将零散知识转化为洞见'
                    }
                ].map((item, index) => (
                    <Col xs={24} md={8} key={index}>
                        <Card
                            hoverable
                            style={{
                                textAlign: 'center',
                                backgroundColor: '#f5f5f5'
                            }}
                        >
                            <div style={{
                                fontSize: '3em',
                                marginBottom: '16px',
                                display: 'flex',
                                justifyContent: 'center',
                                color: '#555'
                            }}>
                                {item.icon}
                            </div>
                            <Title level={4}>{item.title}</Title>
                            <Paragraph>{item.desc}</Paragraph>
                        </Card>
                    </Col>
                ))}
            </Row>
        ),
        // Rest of the tab contents follow a similar pattern of conversion
        how: (
            <Row gutter={[24, 24]} align="middle" justify="center">
                <List
                    itemLayout="vertical"
                    dataSource={[
                        { step: '下载安装', desc: '去谷歌应用商店下载BeCurator' },
                        { step: '配置LLM模型', desc: '选择合适的模型,中文推荐QianWen,英文推荐Llama', imgList: ['./img/setup_llm.png'] },
                        { step: '导入资源', desc: '上传文档、网页链接', imgList: ['./img/add_resource/1.png', './img/add_resource/2.png', './img/add_resource/3.png', './img/add_resource/4.png', './img/add_resource/5.png'] },
                        { step: '智能搜索', desc: '使用自然语言查询', imgList: ['./img/search.png'] },
                    ]}
                    renderItem={(item, index) => (
                        <List.Item key={index}>
                            <Title level={4}>{item.step}</Title>
                            <Paragraph>{item.desc}</Paragraph>
                            {
                                item.imgList &&
                                <Image.PreviewGroup >
                                    {item.imgList.map((imgSrc, imgIndex) => (
                                        <Image key={imgIndex} src={imgSrc} width={100} height={100} style={{ objectFit: 'cover' }} />
                                    ))}
                                </Image.PreviewGroup>
                            }
                        </List.Item>
                    )}
                />
            </Row>
        ),
        features: (
            <Row gutter={[24, 24]}>
                {[
                    { title: 'gpt4等模型兼容', desc: '打通第三方大模型的调用能力' },
                    { title: '邮箱扩展', desc: '满足需要分析与检索邮箱信息的用户' },
                    { title: '知识库扩展', desc: '打通第三方知识库数据获取,如notion等' },
                    { title: '数据分析', desc: '支持各类表格等数据分析' }
                ].map((item, index) => (
                    <Col xs={24} md={6} key={index}>
                        <Card
                            style={{
                                textAlign: 'center',
                                backgroundColor: 'white'
                            }}
                        >
                            <Title level={4}>{item.title}</Title>
                            <Paragraph>{item.desc}</Paragraph>
                        </Card>
                    </Col>
                ))}
            </Row>
        )
    };

    const [antDLocale, setAntDLocal] = useState<Locale>(enUS);

    const initLang = () => {
        const curLang = navigator.language || 'en';
        if (curLang.startsWith('zh')) {
            setAntDLocal(zhCN);
        }
    }
    const checkWebGPU = async () => {
        //@ts-ignore
        if (!navigator.gpu) {
            console.error("WebGPU is not supported.");
            return false;
        }
        try {
            //@ts-ignore
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                return true;
            } else {
                console.error("WebGPU is supported but no suitable adapter was found.");
                return false;
            }
        } catch (error) {
            console.error("An error occurred while requesting the WebGPU adapter:", error);
            return false;
        }
    }

    useLayoutEffect(() => {
        initLang();

    }, []);

    useEffect(() => {
        checkWebGPU().then((isSupport) => {
            setIsWebGPUSupported(isSupport);
        });
    }, []);

    return (

        <ConfigProvider
            locale={antDLocale}
            theme={{
                token: {
                    colorPrimary: '#404040',
                }
            }}
        >
            <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
                {/* Header */}
                <header style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                    backgroundColor: 'white',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                    <Row justify="space-between" align="middle" style={{ padding: '16px' }}>
                        <Col>
                            <Title level={3} style={{ margin: 0, color: '#333' }}>BeCurator</Title>
                        </Col>
                        <Col>
                            <Space>
                                {/* <Button type="text">功能</Button> */}
                                {/* <Button type="text">文档</Button> */}
                                <Button type="primary" style={{ backgroundColor: '#404040' }}>
                                    立即下载
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </header>

                {/* Main Content */}
                <main style={{ padding: '48px 24px' }}>
                    {/* Hero Section */}
                    <section style={{ textAlign: 'center', marginBottom: '64px' }}>
                        <Title level={1}>BeCurator: 个人知识管理的革命性工具</Title>
                        <Paragraph style={{
                            maxWidth: '800px',
                            margin: '0 auto 32px',
                            color: '#666'
                        }}>
                            一站式知识收集、本地存储、本地AI计算和智能检索，将您的知识转化为可即时访问的个人智能助理。
                        </Paragraph>
                        <Space>
                            <Button
                                type="primary"
                                size="large"
                            >
                                免费下载
                            </Button>
                        </Space>
                    </section>

                    {/* Tabbed Content */}
                    <Tabs
                        defaultActiveKey="what"
                        centered
                        size="large"
                        items={[
                            { key: 'what', label: t('what_it_is') + '?', children: tabContents.what },
                            { key: 'why', label: '为什么使用它?', children: tabContents.why },
                            { key: 'how', label: '如何使用它?', children: tabContents.how },
                            { key: 'features', label: '即将上线功能', children: tabContents.features }
                        ]}
                    />

                    {/* Video Section */}
                    <section style={{
                        marginTop: '64px',
                        textAlign: 'center'
                    }}>
                        <Title level={2}>产品演示</Title>
                        <div className="flex gap-10 justify-center h-[800px] overflow-hidden">
                            <div className='flex flex-col items-center gap-2'>
                                <div className="text-lg font-bold">搜索</div>
                                <video src={'./video/search.mp4'} autoPlay muted loop />
                            </div>
                            <div className='flex flex-col items-center gap-2'>
                                <div className="text-lg font-bold">聊天</div>
                                <video src={'./video/chat.mp4'} autoPlay muted loop />
                            </div>
                        </div>
                    </section>

                    {/* Recommended Configuration Section */}
                    <section style={{
                        backgroundColor: '#f5f5f5',
                        padding: '64px 0',
                        marginTop: '64px'
                    }}>
                        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                            <Title level={2} style={{ textAlign: 'center', marginBottom: '32px' }}>
                                配置要求
                            </Title>
                            <Row gutter={[24, 24]}>
                                <Col xs={24} md={12}>
                                    <Card className='h-[150px]'>
                                        <Space direction="vertical">
                                            <Title level={4} className='flex items-center gap-2'>
                                                <FiCheckCircle size={24} color='green' />
                                                <span>
                                                    电脑配置
                                                </span>
                                            </Title>
                                            <div>
                                                <Text strong>浏览器：</Text>Chrome 浏览器
                                                <Text type="secondary" style={{ marginLeft: '8px' }}>
                                                    (版本 113 及以上)
                                                </Text>
                                            </div>
                                            <div>
                                                <Text strong>推荐内存：</Text>16G+
                                            </div>
                                        </Space>
                                    </Card>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Card className='h-[150px]'>
                                        <Title level={4} className='gap-2 flex items-center'>
                                            <AiOutlineInfoCircle size={26} color='blue' />
                                            <span>
                                                WebGPU 支持
                                            </span>
                                        </Title>
                                        {isWebGPUSupported ? (
                                            <Paragraph
                                                style={{
                                                    color: isWebGPUSupported ? 'green' : 'default',
                                                    marginTop: '16px'
                                                }}
                                            >
                                                ✓ 您的浏览器支持 WebGPU
                                            </Paragraph>
                                        ) : (
                                            <Paragraph style={{ color: 'red', marginTop: '16px' }}>
                                                × 您的浏览器不支持 WebGPU，建议升级 Chrome 浏览器
                                            </Paragraph>
                                        )

                                        }
                                    </Card>
                                </Col>
                            </Row>
                        </div>
                    </section>

                    {/* User Guidance Section */}
                    <section style={{ padding: '64px 0' }}>
                        <Card
                            style={{
                                maxWidth: '1000px',
                                margin: '0 auto',
                                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                            }}
                        >
                            <Title level={2} style={{ textAlign: 'center', marginBottom: '32px' }}>
                                如何更好地使用系统
                            </Title>
                            <Space direction="vertical" size="large">
                                <div>
                                    <Title level={4}>系统工作原理</Title>
                                    <Paragraph>
                                        BeCurator 基于语义和关键词匹配技术。当您输入问题时，系统会智能地分析您的查询，并从知识库中检索最相关的信息。
                                    </Paragraph>
                                </div>
                                <div>
                                    <Title level={4}>优化搜索建议</Title>
                                    <List
                                        itemLayout="horizontal"
                                        dataSource={[
                                            '如果初次搜索结果不满意，可尝试调整您的询问语句。',
                                            '使用更精确的关键词或相近的语义词，避免过于宽泛或模糊的表述。',
                                            '必要时可以尝试使用不同的表达方式或同义词。'
                                        ]}
                                        renderItem={(item) => (
                                            <List.Item>
                                                <Text>{item}</Text>
                                            </List.Item>
                                        )}
                                    />
                                </div>
                            </Space>
                        </Card>
                    </section>
                </main>

                {/* Footer */}
                <footer style={{
                    backgroundColor: 'white',
                    padding: '32px 0',
                    borderTop: '1px solid #f0f0f0'
                }}>
                    <div className="text-lg text-center mb-[14px]">作者感言</div>
                    <Paragraph style={{ textAlign: 'center', color: '#666' }}>
                        开发该系统的想法,来自于DAnswer,从很多设计与功能上都有借鉴,感谢DAnswer团队的开源精神
                    </Paragraph>
                    <Paragraph style={{ textAlign: 'center', color: '#666' }}>
                        <a href='https://www.danswer.ai/'>DAnswer官网</a>
                    </Paragraph>

                </footer>
            </div>
        </ConfigProvider>
    );
};

export default BeCuratorLandingPage;