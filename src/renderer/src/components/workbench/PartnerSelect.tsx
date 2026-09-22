import { useMemo } from 'react'
import { Select } from 'antd'
import type { PartnerListItem } from '../../../../shared/types'
import PartnerAvatar from './PartnerAvatar'

type PartnerSelectProps = {
  partners: PartnerListItem[]
  value?: string
  placeholder?: string
  className?: string
  dataTestId: string
  onChange: (partnerId: string) => void
}

const PartnerSelect: React.FC<PartnerSelectProps> = ({
  partners,
  value,
  placeholder = '选择伙伴',
  className,
  dataTestId,
  onChange
}) => {
  const partnerById = useMemo(
    () => new Map(partners.map((partner) => [partner.id, partner])),
    [partners]
  )
  const options = useMemo(
    () => partners.map((partner) => ({ value: partner.id, label: partner.name })),
    [partners]
  )

  const renderPartner = (partner: PartnerListItem, location: 'option' | 'selected') => (
    <div
      className={`nc-partner-select-row nc-partner-select-row-${location}`}
      data-testid={`${dataTestId}-${location}-${partner.id}`}
    >
      <PartnerAvatar
        shape={partner.avatar_shape}
        color={partner.avatar_color}
        size={location === 'option' ? 32 : 28}
        animationSeed={`${location}-${partner.id}`}
        animated
      />
      <span className="min-w-0 flex-1 truncate">{partner.name}</span>
    </div>
  )

  return (
    <Select
      className={`nc-partner-select ${className || ''}`.trim()}
      popupClassName="nc-partner-select-dropdown"
      value={value}
      placeholder={placeholder}
      data-testid={dataTestId}
      options={options}
      notFoundContent="暂无伙伴"
      onChange={onChange}
      labelRender={({ value: selectedValue, label }) => {
        const partner = partnerById.get(String(selectedValue))
        return partner ? renderPartner(partner, 'selected') : label
      }}
      optionRender={(option) => {
        const partner = partnerById.get(String(option.value))
        return partner ? renderPartner(partner, 'option') : option.label
      }}
    />
  )
}

export default PartnerSelect
