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
    FaBrain,
} from 'react-icons/fa';
import { AiFillSafetyCertificate } from "react-icons/ai";
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
            <div className='flex flex-col gap-[24px] items-center'>
                <Title level={2}>{t('what_it_is')}?</Title>
                <Paragraph className='max-w-[1000px] text-base'>
                    <span className='font-bold'>BeCurator</span> {t('BeCurator_desc')}
                </Paragraph>

                <Space direction="vertical">
                    {[
                        { icon: <CiFileOn size={30} />, text: t('multi_source_file_import') },
                        { icon: <CiDatabase size={30} />, text: t('local_data_storage') },
                        { icon: <CiSearch size={30} />, text: t('intelligent_semantic_search') }
                    ].map((item, index) => (
                        <Space key={index} align="center">
                            <Text style={{ fontSize: '1.5em', color: '#555' }}>{item.icon}</Text>
                            <Text>{item.text}</Text>
                        </Space>
                    ))}
                </Space>
            </div>
        ),
        why: (
            <Row gutter={[24, 24]}>
                {[
                    {
                        icon: <FaSearch />,
                        title: t('accurate_search'),
                        desc: t('vector_search_technology')
                    },
                    {
                        icon: <AiFillSafetyCertificate />,
                        title: t('data_security'),
                        desc: t('data_and_ai_computation')
                    },
                    {
                        icon: <FaBrain />,
                        title: t('intelligent_analysis'),
                        desc: t('ai_driven_deep_analysis')
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
                    className='max-w-[600px]'
                    itemLayout="vertical"
                    dataSource={[
                        { step: t('download_and_install'), desc: t('download_becurator_from_google_play') },
                        { step: t('configure_llm_model'), desc: t('choose_appropriate_model'), imgList: ['./img/llm_setup/1.png', './img/llm_setup/2.png', './img/llm_setup/3.png',] },
                        { step: t('import_resources'), desc: t('upload_documents_and_links'), imgList: ['./img/add_resource/1.png', './img/add_resource/2.png', './img/add_resource/3.png', './img/add_resource/4.png', './img/add_resource/5.png'] },
                        { step: t('intelligent_search'), desc: t('use_natural_language_query'), imgList: ['./img/search.png'] },
                    ]}
                    renderItem={(item, index) => (
                        <List.Item key={index}>
                            <Title level={4}>{item.step}</Title>
                            <Paragraph className='max-w-[400px]'>{item.desc}</Paragraph>
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
                    {
                        title: t('gpt4_compatible_models')
                        , desc: t('integrate_third_party_models')
                    },
                    { title: t('email_extension'), desc: t('meet_user_needs_for_email_analysis_and_search') },
                    { title: t('knowledge_base_extension'), desc: t('integrate_third_party_knowledge_base_data') },
                    { title: t('data_analysis'), desc: t('support_table_data_analysis') }
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
        ),
        help: (
            <div className='flex justify-center'>
                <div>
                    <div className='font-bold text-lg text-center mb-2'>xiaoyuan9816@gmail.com</div>
                    <div className='font-bold text-lg text-center mb-2'>QQ反馈群: 891209383</div>
                    <div className='text-center'>{t('author_email_feedback')}</div>
                </div>
            </div>
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
                                    {t('free_download')}
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </header>

                {/* Main Content */}
                <main style={{ padding: '48px 24px' }}>
                    {/* Hero Section */}
                    <section style={{ textAlign: 'center', marginBottom: '64px' }}>
                        <Title level={1}>BeCurator: {t('revolutionary_personal_knowledge_management_tool')}</Title>
                        <Paragraph style={{
                            maxWidth: '800px',
                            margin: '0 auto 32px',
                            color: '#666'
                        }}>
                            {t('one_stop_knowledge_collection_local_storage_ai_computation_and_intelligent_search')
                            }
                        </Paragraph>
                        <Space>
                            <Button
                                type="primary"
                                size="large"
                            >
                                {t('free_download')}
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
                            { key: 'why', label: t('why_use_it') + '?', children: tabContents.why },
                            { key: 'how', label: t('how_to_use_it') + '?', children: tabContents.how },
                            { key: 'help', label: t('need_help') + '?', children: tabContents.help },
                            { key: 'features', label: t('next_stage_features'), children: tabContents.features }
                        ]}
                    />

                    {/* Video Section */}
                    <section style={{
                        marginTop: '64px',
                        textAlign: 'center'
                    }}>
                        <Title level={2}>{t('demo')}</Title>
                        <div className="flex flex-col gap-10">
                            <div className='flex flex-col items-center gap-2'>
                                <div className="text-lg font-bold">{t('search_mode')}</div>
                                <video src={'./video/search.mp4'} className='rounded-lg' style={{ maxWidth: '1000px', boxShadow: `rgba(0, 0, 0, 0.1) 0px 4px 6px` }} autoPlay muted loop />
                            </div>
                            <div className='flex flex-col items-center gap-2'>
                                <div className="text-lg font-bold">{t('chat_mode')}</div>
                                <video src={'./video/chat.mp4'} className='rounded-lg' style={{ maxWidth: '1000px', boxShadow: `rgba(0, 0, 0, 0.1) 0px 4px 6px` }} autoPlay muted loop />
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
                                {t('configuration_recommendations')}
                            </Title>
                            <Row gutter={[24, 24]}>
                                <Col xs={24} md={12}>
                                    <Card className='h-[150px]'>
                                        <Space direction="vertical">
                                            <Title level={4} className='flex items-center gap-2'>
                                                <FiCheckCircle size={24} color='green' />
                                                <span>
                                                    {t('computer_configuration')}
                                                </span>
                                            </Title>
                                            <div>
                                                <Text strong>{t('browser')}：</Text>Chrome
                                                <Text type="secondary" style={{ marginLeft: '8px' }}>
                                                    {t('version_113_and_above')}
                                                </Text>
                                            </div>
                                            <div>
                                                <Text strong>{t('minimum_memory')}：</Text>8GB ({t('cloud')} LLM), 16GB ({t('local')} LLM)
                                            </div>
                                        </Space>
                                    </Card>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Card className='h-[150px]'>
                                        <Title level={4} className='gap-2 flex items-center'>
                                            <AiOutlineInfoCircle size={26} color='blue' />
                                            <span>
                                                {t('webgpu_support')}
                                            </span>
                                        </Title>
                                        {isWebGPUSupported ? (
                                            <Paragraph
                                                style={{
                                                    color: isWebGPUSupported ? 'green' : 'default',
                                                    marginTop: '16px'
                                                }}
                                            >
                                                {t('browser_supports_webgpu')}
                                            </Paragraph>
                                        ) : (
                                            <Paragraph style={{ color: 'red', marginTop: '16px' }}>
                                                {t('browser_does_not_support_webgpu')}
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
                                {t('how_to_use_becurator_better')}
                            </Title>
                            <Space direction="vertical" size="large">
                                <div>
                                    <Title level={4}>{t('becurator_working_principle')}</Title>
                                    <Paragraph>
                                        {t('becurator_working_principle_description')}
                                    </Paragraph>
                                </div>
                                <div>
                                    <Title level={4}>{t('optimize_search_suggestions')}</Title>
                                    <List
                                        itemLayout="horizontal"
                                        dataSource={[
                                            t('adjust_query_for_better_results'),
                                            t('use_precise_keywords_or_synonyms'),
                                            t('try_different_phrases_or_synonyms_if_needed')
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

            </div>
        </ConfigProvider>
    );
};

export default BeCuratorLandingPage;