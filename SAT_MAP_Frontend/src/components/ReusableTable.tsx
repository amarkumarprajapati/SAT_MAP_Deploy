'use client';

import React from 'react';
import { Table, ConfigProvider } from 'antd';
import type { TableProps } from 'antd';

export type ReusableTableProps<T> = TableProps<T>;

export default function ReusableTable<T extends object>(props: ReusableTableProps<T>) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgContainer: '#0b1119',
          colorText: '#dbe4ef',
          colorTextHeading: '#a8b4c4',
          colorBorderSecondary: 'rgba(148, 163, 184, 0.13)',
          colorPrimary: '#00e5ff', 
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          borderRadius: 8,
          colorBgElevated: '#111a25',
          colorTextPlaceholder: '#718096',
          fontSize: 12,
        },
        components: {
          Table: {
            headerBg: '#101822',
            headerColor: '#a8b4c4',
            rowHoverBg: 'rgba(34, 211, 238, 0.055)',
            cellPaddingBlock: 14,
            cellPaddingInline: 16,
            borderColor: 'rgba(148, 163, 184, 0.11)',
          },
          Pagination: {
            itemActiveBg: 'rgba(0, 229, 255, 0.12)',
            colorPrimary: '#00e5ff',
            colorText: '#a1a1aa',
          }
        }
      }}
    >
      <Table
        {...props}
        className={`dashboard-data-table w-full h-full flex flex-col [&_.ant-spin-nested-loading]:flex-1 [&_.ant-spin-nested-loading]:flex [&_.ant-spin-nested-loading]:flex-col [&_.ant-spin-container]:flex-1 [&_.ant-spin-container]:flex [&_.ant-spin-container]:flex-col [&_.ant-table]:flex-1 [&_.ant-table]:!bg-transparent [&_.ant-pagination]:!mt-auto [&_.ant-pagination]:!pt-3 [&_.ant-pagination]:!border-t [&_.ant-pagination]:!border-white/10 ${props.className ?? ''}`}
      />
    </ConfigProvider>
  );
}
